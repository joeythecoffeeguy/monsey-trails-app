import { randomUUID } from "node:crypto";
import { json, Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  adminNotificationDevicesTable,
  db,
  departureRemindersTable,
  passengerAlertsTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { requireAdmin } from "./admin-drivers";
import {
  DEPARTURE_REMINDER_BACKGROUND_READY,
  departureReminderBackgroundPolicy,
  sendWebPushSubscription,
} from "../lib/departure-reminders";
import {
  hashAdminNotificationCapability,
  ownsAdminNotificationDevice,
  parseAdminNotificationCapability,
  parseAdminNotificationRegistration,
  publicNotificationHealth,
} from "../lib/admin-notification-security";

const router: IRouter = Router();
router.use("/admin/notifications", requireAdmin, json({ limit: "16kb" }));

router.get("/admin/notifications/health", async (_req, res) => {
  const [alerts, reminders, webSubscriptions, adminDevices] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${passengerAlertsTable.state} in ('pending', 'sending'))::int`,
      accepted: sql<number>`count(*) filter (where ${passengerAlertsTable.state} = 'delivered')::int`,
      failures: sql<number>`count(*) filter (where ${passengerAlertsTable.lastError} is not null)::int`,
      lastAttemptAt: sql<Date | null>`max(${passengerAlertsTable.updatedAt}) filter (where ${passengerAlertsTable.state} in ('sending', 'delivered') or ${passengerAlertsTable.lastError} is not null)`,
    }).from(passengerAlertsTable),
    db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${departureRemindersTable.state} in ('active', 'sending'))::int`,
      accepted: sql<number>`count(*) filter (where ${departureRemindersTable.state} = 'delivered')::int`,
      failures: sql<number>`coalesce(sum(${departureRemindersTable.failureCount}), 0)::int`,
      invalidDevices: sql<number>`count(*) filter (where ${departureRemindersTable.state} = 'error')::int`,
      lastAttemptAt: sql<Date | null>`max(${departureRemindersTable.updatedAt}) filter (where ${departureRemindersTable.state} in ('sending', 'delivered', 'error') or ${departureRemindersTable.failureCount} > 0)`,
    }).from(departureRemindersTable),
    db.select({ total: sql<number>`count(*)::int` }).from(pushSubscriptionsTable),
    db.select({
      registered: sql<number>`count(*) filter (where ${adminNotificationDevicesTable.state} <> 'invalid')::int`,
      invalid: sql<number>`count(*) filter (where ${adminNotificationDevicesTable.state} = 'invalid')::int`,
      failures: sql<number>`count(*) filter (where ${adminNotificationDevicesTable.state} = 'error')::int`,
      lastAttemptAt: sql<Date | null>`max(${adminNotificationDevicesTable.lastAttemptAt})`,
    }).from(adminNotificationDevicesTable),
  ]);
  res.json(publicNotificationHealth({
    passengerAlerts: alerts[0],
    departureReminders: reminders[0],
    webStopSubscriptions: webSubscriptions[0]?.total ?? 0,
    adminTestDevices: adminDevices[0],
    background: {
      ready: DEPARTURE_REMINDER_BACKGROUND_READY,
      detail: departureReminderBackgroundPolicy(),
    },
  }));
});

router.post("/admin/notifications/device", async (req, res) => {
  const registration = parseAdminNotificationRegistration(req.body);
  if (!registration) {
    res.status(400).json({ error: "A supported browser push subscription created by this browser is required.", code: "INVALID_PUSH_SUBSCRIPTION" });
    return;
  }
  const adminSubject = res.locals.adminSubject as string;
  const now = new Date();
  const [saved] = await db.insert(adminNotificationDevicesTable).values({
    id: randomUUID(), adminSubject, ...registration, updatedAt: now,
  }).onConflictDoUpdate({
    target: [adminNotificationDevicesTable.adminSubject, adminNotificationDevicesTable.capabilityHash],
    set: { endpoint: registration.endpoint, p256dh: registration.p256dh, auth: registration.auth, state: "registered", lastError: null, updatedAt: now },
  }).returning({ state: adminNotificationDevicesTable.state });
  res.status(201).json({ state: saved.state });
});

router.post("/admin/notifications/test", async (req, res) => {
  const capability = parseAdminNotificationCapability(req.body);
  if (!capability) {
    res.status(400).json({ error: "Register notifications from this browser before testing.", code: "DEVICE_REGISTRATION_REQUIRED" });
    return;
  }
  const adminSubject = res.locals.adminSubject as string;
  const [device] = await db.select().from(adminNotificationDevicesTable).where(and(
    eq(adminNotificationDevicesTable.adminSubject, adminSubject),
    eq(adminNotificationDevicesTable.capabilityHash, hashAdminNotificationCapability(capability)),
  )).orderBy(desc(adminNotificationDevicesTable.updatedAt)).limit(1);
  if (!device) {
    res.status(404).json({ error: "This browser is not registered to the current administrator.", code: "OWN_DEVICE_NOT_FOUND" });
    return;
  }
  if (!ownsAdminNotificationDevice(device, adminSubject, capability)) {
    res.status(404).json({ error: "This browser is not registered to the current administrator.", code: "OWN_DEVICE_NOT_FOUND" });
    return;
  }
  const now = new Date();
  try {
    await sendWebPushSubscription(device, {
      title: "Notification test",
      body: "Monsey Trails notification provider test.",
      tag: `admin-notification-test-${device.id}`,
      url: "/admin/notifications",
    });
    await db.update(adminNotificationDevicesTable).set({
      state: "accepted", lastAttemptAt: now, lastAcceptedAt: now, lastError: null, updatedAt: now,
    }).where(eq(adminNotificationDevicesTable.id, device.id));
    res.json({ state: "accepted", message: "Provider accepted the test. Delivery or reading is not confirmed." });
  } catch (error) {
    const invalid = Boolean((error as { permanent?: boolean }).permanent);
    await db.update(adminNotificationDevicesTable).set({
      state: invalid ? "invalid" : "error",
      lastAttemptAt: now,
      lastError: error instanceof Error ? error.message.slice(0, 300) : "Provider request failed",
      updatedAt: now,
    }).where(eq(adminNotificationDevicesTable.id, device.id));
    res.status(invalid ? 410 : 502).json({
      error: invalid ? "This browser subscription is no longer valid. Register it again." : "The push provider did not accept the test.",
      code: invalid ? "DEVICE_INVALID" : "PROVIDER_REJECTED",
    });
  }
});

export default router;