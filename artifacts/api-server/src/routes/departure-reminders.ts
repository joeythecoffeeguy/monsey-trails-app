import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, departureRemindersTable, type DepartureReminderRow } from "@workspace/db";
import { isSupportedPushEndpoint } from "./push-endpoint";
import { isExpoPushToken } from "./passenger-alerts";
import {
  DEFAULT_DEPARTURE_REMINDER_LEAD_MINUTES,
  departureReminderBackgroundPolicy,
  MAX_DEPARTURE_REMINDER_LEAD_MINUTES,
  MIN_DEPARTURE_REMINDER_LEAD_MINUTES,
  departureReminderWebPublicKey,
  isoWeekday,
  nextPublishedOccurrence,
  publishedOccurrence,
  startDepartureReminderScheduler,
} from "../lib/departure-reminders";

const router: IRouter = Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

type ParsedReminder = {
  deviceId: string;
  kind: "once" | "weekly";
  serviceDate: string;
  line: number;
  origin: number;
  destination: number;
  runId: string;
  weekdays: number[];
  leadMinutes: number;
  channel: "expo" | "web";
  expoPushToken: string | null;
  webEndpoint: string | null;
  webP256dh: string | null;
  webAuth: string | null;
};

const CAPABILITY_HEADER = "x-departure-reminder-capability";

function validServiceDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function ownerCapability(req: { get(name: string): string | undefined }) {
  const capability = req.get(CAPABILITY_HEADER)?.trim() ?? "";
  return /^[A-Za-z0-9_-]{43,128}$/.test(capability) ? capability : null;
}

function ownerCapabilityHash(capability: string) {
  return createHash("sha256").update(capability, "utf8").digest("hex");
}

function parseReminder(body: unknown): ParsedReminder | null {
  const value = body as Record<string, any> | null;
  if (!value) return null;
  const deviceId = typeof value.deviceId === "string" ? value.deviceId.trim() : "";
  const kind = value.kind;
  const serviceDate = typeof value.serviceDate === "string" ? value.serviceDate : "";
  const line = Number(value.line);
  const origin = Number(value.origin);
  const destination = Number(value.destination);
  const runId = typeof value.runId === "string" ? value.runId.trim() : "";
  const leadMinutes = value.leadMinutes === undefined
    ? DEFAULT_DEPARTURE_REMINDER_LEAD_MINUTES
    : Number(value.leadMinutes);
  const weekdays = kind === "once" ? [] : [...new Set(
    Array.isArray(value.weekdays) ? value.weekdays.map(Number) : [],
  )].sort((a, b) => a - b);
  const delivery = value.delivery as Record<string, any> | undefined;
  const channel = delivery?.type;
  const expoPushToken = channel === "expo" && typeof delivery?.expoPushToken === "string"
    ? delivery.expoPushToken : null;
  const webEndpoint = channel === "web" && typeof delivery?.subscription?.endpoint === "string"
    ? delivery.subscription.endpoint : null;
  const webP256dh = channel === "web" && typeof delivery?.subscription?.keys?.p256dh === "string"
    ? delivery.subscription.keys.p256dh : null;
  const webAuth = channel === "web" && typeof delivery?.subscription?.keys?.auth === "string"
    ? delivery.subscription.keys.auth : null;
  if (
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(deviceId)
    || (kind !== "once" && kind !== "weekly")
    || !validServiceDate(serviceDate)
    || ![1, 2, 3].includes(line)
    || !Number.isInteger(origin) || origin < 1
    || !Number.isInteger(destination) || destination < 1 || origin === destination
    || !runId || runId.length > 100
    || !Number.isInteger(leadMinutes)
    || leadMinutes < MIN_DEPARTURE_REMINDER_LEAD_MINUTES
    || leadMinutes > MAX_DEPARTURE_REMINDER_LEAD_MINUTES
    || (kind === "weekly" && (!weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)))
    || (channel === "expo" ? !isExpoPushToken(expoPushToken) : channel === "web"
      ? !isSupportedPushEndpoint(webEndpoint) || !webP256dh || !webAuth
      : true)
  ) return null;
  return {
    deviceId, kind, serviceDate, line, origin, destination, runId, weekdays, leadMinutes,
    channel, expoPushToken, webEndpoint, webP256dh, webAuth,
  };
}

function publicReminder(row: DepartureReminderRow) {
  return {
    id: row.id,
    deviceId: row.deviceId,
    kind: row.kind,
    serviceDate: row.serviceDate,
    line: row.line,
    origin: row.origin,
    destination: row.destination,
    runId: row.runId,
    weekdays: row.weekdays,
    leadMinutes: row.leadMinutes,
    deliveryType: row.channel,
    state: row.state,
    nextOccurrenceAt: row.nextOccurrenceAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    policy: `The server rechecks the published schedule before every alert. Changed times replace old times; removed trips send a cancellation. Weekly reminders only fire when that trip is actually published. ${departureReminderBackgroundPolicy()} Push delivery cannot be committed atomically with this server, so a rare duplicate is possible after a crash; stable notification tags are used to collapse duplicates.`,
  };
}

async function initialOccurrence(input: ParsedReminder) {
  const selected = await publishedOccurrence(input, input.serviceDate);
  if (!selected) return null;
  if (input.kind === "once") return selected;
  return nextPublishedOccurrence({ ...input, lastOccurrenceDate: null }, new Date());
}

router.get("/passenger/departure-reminders/push-public-key", async (_req, res): Promise<void> => {
  res.json({ publicKey: await departureReminderWebPublicKey() });
});

router.get("/passenger/departure-reminders", async (req, res): Promise<void> => {
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId.trim() : "";
  const capability = ownerCapability(req);
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(deviceId) || !capability) {
    res.status(400).json({ error: "A valid installation identity is required." });
    return;
  }
  const rows = await db.select().from(departureRemindersTable)
    .where(and(
      eq(departureRemindersTable.deviceId, deviceId),
      eq(departureRemindersTable.ownerCapabilityHash, ownerCapabilityHash(capability)),
    ))
    .orderBy(desc(departureRemindersTable.createdAt));
  res.json({ reminders: rows.map(publicReminder) });
});

router.post("/passenger/departure-reminders", async (req, res): Promise<void> => {
  const input = parseReminder(req.body);
  const capability = ownerCapability(req);
  if (!input || !capability) {
    res.status(400).json({ error: "Choose a published trip, valid weekdays, a 5–120 minute lead time, and an authorized notification channel." });
    return;
  }
  try {
    const occurrence = await initialOccurrence(input);
    if (!occurrence) {
      res.status(409).json({ error: input.kind === "weekly"
        ? "That trip has no published service on the selected weekdays in the next two weeks."
        : "That departure is no longer in the published schedule." });
      return;
    }
    const now = new Date();
    const [created] = await db.insert(departureRemindersTable).values({
      id: randomUUID(),
      ...input,
      ownerCapabilityHash: ownerCapabilityHash(capability),
      state: "active",
      nextOccurrenceAt: occurrence.departureAt,
      nextOccurrenceServiceDate: occurrence.serviceDate,
      lastScheduledDepartureAt: occurrence.departureAt,
      nextCheckAt: new Date(Math.min(
        occurrence.departureAt.getTime() - input.leadMinutes * 60_000,
        now.getTime() + 30 * 60_000,
      )),
    }).returning();
    res.status(201).json({ reminder: publicReminder(created) });
  } catch (error) {
    req.log.warn({ err: error }, "departure reminder schedule validation failed");
    res.status(502).json({ error: "The published schedule could not be checked. No reminder was created." });
  }
});

router.put("/passenger/departure-reminders/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const input = parseReminder(req.body);
  const capability = ownerCapability(req);
  if (!/^[0-9a-f-]{36}$/.test(id) || !input || !capability) {
    res.status(400).json({ error: "Choose a valid reminder, published trip, weekdays, lead time, and notification channel." });
    return;
  }
  const [existing] = await db.select().from(departureRemindersTable).where(and(
    eq(departureRemindersTable.id, id),
    eq(departureRemindersTable.deviceId, input.deviceId),
    eq(departureRemindersTable.ownerCapabilityHash, ownerCapabilityHash(capability)),
  )).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Reminder not found." });
    return;
  }
  try {
    const occurrence = await initialOccurrence(input);
    if (!occurrence) {
      res.status(409).json({ error: "No matching published service is available for that reminder." });
      return;
    }
    const now = new Date();
    const [saved] = await db.update(departureRemindersTable).set({
      ...input,
      state: "active",
      nextOccurrenceAt: occurrence.departureAt,
      nextOccurrenceServiceDate: occurrence.serviceDate,
      lastScheduledDepartureAt: occurrence.departureAt,
      lastOccurrenceDate: null,
      lastNotifiedEventKey: null,
      failureCount: 0,
      lastError: null,
      nextCheckAt: new Date(Math.min(
        occurrence.departureAt.getTime() - input.leadMinutes * 60_000,
        now.getTime() + 30 * 60_000,
      )),
      updatedAt: now,
    }).where(and(
      eq(departureRemindersTable.id, id),
      eq(departureRemindersTable.deviceId, input.deviceId),
      eq(departureRemindersTable.ownerCapabilityHash, ownerCapabilityHash(capability)),
    )).returning();
    res.json({ reminder: publicReminder(saved) });
  } catch (error) {
    req.log.warn({ err: error }, "departure reminder update validation failed");
    res.status(502).json({ error: "The published schedule could not be checked. The reminder was not changed." });
  }
});

router.delete("/passenger/departure-reminders/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const capability = ownerCapability(req);
  if (!/^[0-9a-f-]{36}$/.test(id) || !capability) {
    res.status(400).json({ error: "A valid reminder and installation identity are required." });
    return;
  }
  const [cancelled] = await db.update(departureRemindersTable).set({
    state: "cancelled", nextOccurrenceAt: null, nextOccurrenceServiceDate: null, updatedAt: new Date(),
  }).where(and(
    eq(departureRemindersTable.id, id),
    eq(departureRemindersTable.ownerCapabilityHash, ownerCapabilityHash(capability)),
  )).returning();
  if (!cancelled) {
    res.status(404).json({ error: "Reminder not found." });
    return;
  }
  res.status(204).end();
});

startDepartureReminderScheduler();

export { ownerCapabilityHash, parseReminder, publicReminder, validServiceDate };
export default router;