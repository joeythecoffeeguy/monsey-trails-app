import webPush from "web-push";
import { and, eq, lte } from "drizzle-orm";
import {
  db,
  departureRemindersTable,
  pushVapidKeysTable,
  type DepartureReminderRow,
} from "@workspace/db";
import { fetchOfficialSchedule, scheduledDepartureInstant } from "../routes/schedule";

export const DEFAULT_DEPARTURE_REMINDER_LEAD_MINUTES = 15;
export const MIN_DEPARTURE_REMINDER_LEAD_MINUTES = 5;
export const MAX_DEPARTURE_REMINDER_LEAD_MINUTES = 120;
export const DEPARTURE_REMINDER_TIME_ZONE = "America/New_York";
const REVALIDATE_INTERVAL_MS = 30 * 60_000;
const RETRY_INTERVAL_MS = 5 * 60_000;
const SEARCH_DAYS = 14;
export const DEPARTURE_REMINDER_SEND_LEASE_MS = 2 * 60_000;
export const DEPARTURE_REMINDER_PROVIDER_TIMEOUT_MS = 8_000;
export const DEPARTURE_REMINDER_BACKGROUND_READY =
  process.env.DEPARTURE_REMINDER_BACKGROUND_READY === "true";

export function departureReminderBackgroundPolicy(
  backgroundReady = DEPARTURE_REMINDER_BACKGROUND_READY,
) {
  return backgroundReady
    ? "Background reminder processing is explicitly configured."
    : "Background timing is not confirmed: reminders require an always-on server or an external scheduled tick. This deployment may scale to zero while idle, which can delay reminders until processing resumes.";
}

type ReminderIdentity = Pick<DepartureReminderRow,
  "kind" | "serviceDate" | "line" | "origin" | "destination" | "runId" | "weekdays" | "lastOccurrenceDate"
>;

export type ReminderOccurrence = {
  serviceDate: string;
  departureAt: Date;
  originName: string;
  destinationName: string;
};

function calendarDate(value: string) {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function addCalendarDays(value: string, days: number) {
  const parsed = calendarDate(value);
  if (!parsed) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function isoWeekday(value: string) {
  const parsed = calendarDate(value);
  return parsed ? (parsed.getUTCDay() || 7) : null;
}

export function serviceDateAt(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEPARTURE_REMINDER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function publishedOccurrence(
  reminder: Pick<ReminderIdentity, "line" | "origin" | "destination" | "runId">,
  serviceDate: string,
): Promise<ReminderOccurrence | null> {
  const schedule = await fetchOfficialSchedule({
    line: reminder.line,
    origin: reminder.origin,
    destination: reminder.destination,
    date: serviceDate,
  });
  const run = schedule.runs.find((candidate: { id: string; scheduledTime: string; firstPickupTime: string }) =>
    candidate.id === reminder.runId);
  if (!run) return null;
  const departureAt = scheduledDepartureInstant(serviceDate, run.scheduledTime || run.firstPickupTime);
  if (!departureAt) return null;
  return {
    serviceDate,
    departureAt,
    originName: schedule.origin.name,
    destinationName: schedule.destination.name,
  };
}

/**
 * Weekly rules are candidate weekdays, not promises of service. Every candidate
 * is checked against the current published schedule and dates without the run
 * are skipped.
 */
export async function nextPublishedOccurrence(
  reminder: ReminderIdentity,
  now: Date,
  lookup = publishedOccurrence,
): Promise<ReminderOccurrence | null> {
  if (reminder.kind === "once") {
    if (!reminder.serviceDate || reminder.lastOccurrenceDate === reminder.serviceDate) return null;
    return lookup(reminder, reminder.serviceDate);
  }
  const today = serviceDateAt(now);
  const start = reminder.serviceDate && reminder.serviceDate > today ? reminder.serviceDate : today;
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const date = addCalendarDays(start, offset);
    if (!date || reminder.lastOccurrenceDate === date || !reminder.weekdays.includes(isoWeekday(date)!)) continue;
    const occurrence = await lookup(reminder, date);
    if (occurrence && occurrence.departureAt.getTime() > now.getTime() - 5 * 60_000) return occurrence;
  }
  return null;
}

export function reminderEventKey(kind: "departure" | "cancelled", occurrence: Pick<ReminderOccurrence, "serviceDate" | "departureAt">) {
  return `${kind}:${occurrence.serviceDate}:${occurrence.departureAt.toISOString()}`;
}

export function departurePushMessage(
  kind: "departure" | "cancelled",
  occurrence: ReminderOccurrence,
  leadMinutes: number,
) {
  if (kind === "cancelled") {
    return {
      title: "Departure cancelled",
      body: `${occurrence.originName} to ${occurrence.destinationName} is no longer in the published schedule.`,
      tag: `departure-cancelled-${occurrence.serviceDate}`,
    };
  }
  return {
    title: "Bus departure reminder",
    body: `${occurrence.originName} to ${occurrence.destinationName} departs in ${leadMinutes} minutes.`,
    tag: `departure-reminder-${occurrence.serviceDate}-${occurrence.departureAt.getTime()}`,
  };
}

type VapidKeys = { publicKey: string; privateKey: string };

export async function initializeSingletonVapidKeys(
  read: () => Promise<VapidKeys | null>,
  insertIfAbsent: (keys: VapidKeys) => Promise<VapidKeys | null>,
  generate: () => VapidKeys,
) {
  const existing = await read();
  if (existing) return existing;
  const created = await insertIfAbsent(generate());
  if (created) return created;
  // Another worker won the singleton insert. Always read its persisted keypair;
  // never return or rotate to this worker's discarded generated pair.
  const concurrent = await read();
  if (!concurrent) throw new Error("Could not initialize push notifications.");
  return concurrent;
}

async function getVapidKeys() {
  return initializeSingletonVapidKeys(async () => {
    const [existing] = await db.select().from(pushVapidKeysTable)
      .where(eq(pushVapidKeysTable.id, "default")).limit(1);
    return existing ?? null;
  }, async (generated) => {
    const [created] = await db.insert(pushVapidKeysTable).values({
      id: "default", publicKey: generated.publicKey, privateKey: generated.privateKey,
    }).onConflictDoNothing().returning();
    return created ?? null;
  }, () => webPush.generateVAPIDKeys());
}

export async function sendWebPushSubscription(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: unknown,
) {
  const vapid = await getVapidKeys();
  webPush.setVapidDetails("https://monseytrails.com", vapid.publicKey, vapid.privateKey);
  try {
    await webPush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, JSON.stringify(payload), {
      TTL: 300,
      urgency: "normal",
      timeout: DEPARTURE_REMINDER_PROVIDER_TIMEOUT_MS,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      throw Object.assign(new Error("Push subscription expired"), { permanent: true });
    }
    throw error;
  }
}

export async function departureReminderWebPublicKey() {
  return (await getVapidKeys()).publicKey;
}

async function sendPush(reminder: DepartureReminderRow, message: ReturnType<typeof departurePushMessage>) {
  const data = { screen: "departure-reminders", reminderId: reminder.id };
  if (reminder.channel === "expo") {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: reminder.expoPushToken,
        title: message.title,
        body: message.body,
        sound: "default",
        channelId: "departure-reminders",
        data,
      }),
      signal: AbortSignal.timeout(DEPARTURE_REMINDER_PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Expo Push API returned ${response.status}`);
    const ticket = await response.json() as { data?: { status?: string; details?: { error?: string } } };
    if (ticket.data?.status !== "ok") {
      const error = ticket.data?.details?.error;
      if (error === "DeviceNotRegistered") throw Object.assign(new Error(error), { permanent: true });
      throw new Error("Expo Push ticket was not accepted");
    }
    return;
  }
  await sendWebPushSubscription({
    endpoint: reminder.webEndpoint!,
    p256dh: reminder.webP256dh!,
    auth: reminder.webAuth!,
  }, { ...message, url: "/", data });
}

async function markEvaluation(reminder: DepartureReminderRow, occurrence: ReminderOccurrence | null, now: Date) {
  if (!occurrence) {
    await db.update(departureRemindersTable).set({
      nextOccurrenceAt: null,
      nextOccurrenceServiceDate: null,
      nextCheckAt: new Date(now.getTime() + 6 * 60 * 60_000),
      updatedAt: now,
    }).where(and(eq(departureRemindersTable.id, reminder.id), eq(departureRemindersTable.state, "active")));
    return;
  }
  const reminderAt = occurrence.departureAt.getTime() - reminder.leadMinutes * 60_000;
  await db.update(departureRemindersTable).set({
    nextOccurrenceAt: occurrence.departureAt,
    nextOccurrenceServiceDate: occurrence.serviceDate,
    lastScheduledDepartureAt: occurrence.departureAt,
    nextCheckAt: new Date(Math.min(reminderAt, now.getTime() + REVALIDATE_INTERVAL_MS)),
    updatedAt: now,
  }).where(and(eq(departureRemindersTable.id, reminder.id), eq(departureRemindersTable.state, "active")));
}

async function deliverEvent(
  reminder: DepartureReminderRow,
  occurrence: ReminderOccurrence,
  kind: "departure" | "cancelled",
  now: Date,
) {
  const eventKey = reminderEventKey(kind, occurrence);
  if (reminder.lastNotifiedEventKey === eventKey) return false;
  const [claimed] = await db.update(departureRemindersTable).set({ state: "sending", updatedAt: now })
    .where(and(eq(departureRemindersTable.id, reminder.id), eq(departureRemindersTable.state, "active"))).returning();
  if (!claimed) return false;
  try {
    await sendPush(claimed, departurePushMessage(kind, occurrence, reminder.leadMinutes));
    const recurring = reminder.kind === "weekly";
    await db.update(departureRemindersTable).set({
      state: recurring ? "active" : kind === "cancelled" ? "cancelled" : "delivered",
      lastOccurrenceDate: recurring || kind === "departure" ? occurrence.serviceDate : reminder.lastOccurrenceDate,
      lastNotifiedEventKey: eventKey,
      nextOccurrenceAt: null,
      nextOccurrenceServiceDate: null,
      nextCheckAt: recurring
        ? new Date(Math.max(now.getTime() + 60_000, occurrence.departureAt.getTime() + 60_000))
        : now,
      failureCount: 0,
      lastError: null,
      updatedAt: now,
    }).where(eq(departureRemindersTable.id, reminder.id));
    return true;
  } catch (error) {
    const permanent = Boolean((error as { permanent?: boolean }).permanent);
    await db.update(departureRemindersTable).set({
      state: permanent ? "error" : "active",
      failureCount: reminder.failureCount + 1,
      lastError: error instanceof Error ? error.message.slice(0, 500) : "Push delivery failed",
      nextCheckAt: new Date(now.getTime() + RETRY_INTERVAL_MS),
      updatedAt: now,
    }).where(eq(departureRemindersTable.id, reminder.id));
    throw error;
  }
}

export async function processDepartureReminder(reminder: DepartureReminderRow, now = new Date()) {
  // If a previously observed occurrence disappears, notify once and do not
  // silently retain its old time. Recurring rules continue on future real service.
  if (reminder.nextOccurrenceAt && reminder.lastScheduledDepartureAt && reminder.nextOccurrenceServiceDate) {
    const priorDate = reminder.nextOccurrenceServiceDate;
    const current = await publishedOccurrence(reminder, priorDate);
    if (!current) {
      const prior: ReminderOccurrence = {
        serviceDate: priorDate,
        departureAt: reminder.lastScheduledDepartureAt,
        originName: "Selected trip",
        destinationName: "destination",
      };
      await deliverEvent(reminder, prior, "cancelled", now);
      return;
    }
  }
  const occurrence = await nextPublishedOccurrence(reminder, now);
  if (!occurrence) {
    if (reminder.kind === "once" && reminder.serviceDate) {
      const prior: ReminderOccurrence = {
        serviceDate: reminder.serviceDate,
        departureAt: reminder.lastScheduledDepartureAt ?? now,
        originName: "Selected trip",
        destinationName: "destination",
      };
      await deliverEvent(reminder, prior, "cancelled", now);
    } else {
      await markEvaluation(reminder, null, now);
    }
    return;
  }
  const reminderAt = occurrence.departureAt.getTime() - reminder.leadMinutes * 60_000;
  if (occurrence.departureAt.getTime() < now.getTime() - 5 * 60_000) {
    await db.update(departureRemindersTable).set({
      state: reminder.kind === "once" ? "cancelled" : "active",
      lastOccurrenceDate: occurrence.serviceDate,
      nextOccurrenceAt: null,
      nextOccurrenceServiceDate: null,
      lastError: "The departure passed before a reminder could be delivered.",
      nextCheckAt: new Date(now.getTime() + 60_000),
      updatedAt: now,
    }).where(and(eq(departureRemindersTable.id, reminder.id), eq(departureRemindersTable.state, "active")));
    return;
  }
  if (reminderAt <= now.getTime() && occurrence.departureAt.getTime() >= now.getTime() - 5 * 60_000) {
    await deliverEvent(reminder, occurrence, "departure", now);
  } else {
    await markEvaluation(reminder, occurrence, now);
  }
}

export async function processDueDepartureReminders(
  now = new Date(),
  log: { error: (value: unknown, message: string) => void } = console,
  options: { limit?: number } = {},
) {
  // A process can stop after claiming but before persisting provider success.
  // Provider calls time out far below this lease, so a healthy attempt cannot
  // overlap a reclaim. A crash after provider acceptance but before our commit
  // still has an unavoidable at-least-once boundary: provider APIs do not offer
  // a transaction spanning delivery and this database. Stable event tags/keys
  // allow providers and clients to collapse that rare duplicate.
  await db.update(departureRemindersTable).set({
    state: "active",
    nextCheckAt: now,
    lastError: "A timed-out delivery attempt was requeued.",
    updatedAt: now,
  }).where(and(
    eq(departureRemindersTable.state, "sending"),
    lte(departureRemindersTable.updatedAt, new Date(now.getTime() - DEPARTURE_REMINDER_SEND_LEASE_MS)),
  ));
  const due = await db.select().from(departureRemindersTable).where(and(
    eq(departureRemindersTable.state, "active"),
    lte(departureRemindersTable.nextCheckAt, now),
  )).limit(Math.max(1, Math.min(options.limit ?? 100, 100)));
  for (const reminder of due) {
    try {
      await processDepartureReminder(reminder, now);
    } catch (error) {
      await db.update(departureRemindersTable).set({
        nextCheckAt: new Date(now.getTime() + RETRY_INTERVAL_MS),
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Schedule revalidation failed",
        updatedAt: now,
      }).where(and(
        eq(departureRemindersTable.id, reminder.id),
        eq(departureRemindersTable.state, "active"),
      ));
      log.error({ err: error, reminderId: reminder.id }, "departure reminder processing failed");
    }
  }
  return due.length;
}

let scheduler: ReturnType<typeof setInterval> | null = null;
export function startDepartureReminderScheduler() {
  if (scheduler || process.env.NODE_ENV === "test") return;
  scheduler = setInterval(() => void processDueDepartureReminders(), 60_000);
  scheduler.unref();
  void processDueDepartureReminders();
}