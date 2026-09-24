import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPARTURE_REMINDER_PROVIDER_TIMEOUT_MS,
  DEPARTURE_REMINDER_SEND_LEASE_MS,
  addCalendarDays,
  initializeSingletonVapidKeys,
  departurePushMessage,
  departureReminderBackgroundPolicy,
  isoWeekday,
  nextPublishedOccurrence,
  reminderEventKey,
  serviceDateAt,
} from "./departure-reminders";

const weekly = {
  kind: "weekly" as const,
  serviceDate: "2026-10-30",
  line: 1,
  origin: 1,
  destination: 2,
  runId: "published-run",
  weekdays: [1, 5],
  lastOccurrenceDate: null,
};

test("New York service dates and ISO weekdays remain correct across DST", () => {
  assert.equal(serviceDateAt(new Date("2026-11-01T03:30:00.000Z")), "2026-10-31");
  assert.equal(serviceDateAt(new Date("2026-11-01T05:30:00.000Z")), "2026-11-01");
  assert.equal(addCalendarDays("2026-10-31", 1), "2026-11-01");
  assert.equal(isoWeekday("2026-11-02"), 1);
});

test("weekly rules skip selected weekdays with no actual published bus", async () => {
  const checked: string[] = [];
  const occurrence = await nextPublishedOccurrence(
    weekly,
    new Date("2026-10-30T04:00:00.000Z"),
    async (_reminder, date) => {
      checked.push(date);
      return date === "2026-11-02"
        ? {
          serviceDate: date,
          departureAt: new Date("2026-11-03T04:30:00.000Z"),
          originName: "New Square",
          destinationName: "Monsey",
        }
        : null;
    },
  );
  assert.deepEqual(checked, ["2026-10-30", "2026-11-02"]);
  assert.equal(occurrence?.serviceDate, "2026-11-02");
});

test("one-time reminders do not re-arm after their occurrence", async () => {
  let calls = 0;
  const occurrence = await nextPublishedOccurrence({
    ...weekly,
    kind: "once",
    serviceDate: "2026-10-30",
    weekdays: [],
    lastOccurrenceDate: "2026-10-30",
  }, new Date("2026-10-29T12:00:00Z"), async () => {
    calls += 1;
    return null;
  });
  assert.equal(occurrence, null);
  assert.equal(calls, 0);
});

test("schedule changes and cancellations have distinct idempotency keys and copy", () => {
  const occurrence = {
    serviceDate: "2026-11-02",
    departureAt: new Date("2026-11-03T04:30:00.000Z"),
    originName: "New Square",
    destinationName: "Monsey",
  };
  assert.notEqual(reminderEventKey("departure", occurrence), reminderEventKey("cancelled", occurrence));
  assert.match(departurePushMessage("departure", occurrence, 15).body, /15 minutes/);
  assert.match(departurePushMessage("cancelled", occurrence, 15).title, /cancelled/i);
});

test("provider timeout leaves a wide margin before a stale send lease can be reclaimed", () => {
  assert.ok(DEPARTURE_REMINDER_PROVIDER_TIMEOUT_MS <= 10_000);
  assert.ok(DEPARTURE_REMINDER_SEND_LEASE_MS >= DEPARTURE_REMINDER_PROVIDER_TIMEOUT_MS * 10);
});

test("background readiness is unconfirmed by default and never promises idle delivery", () => {
  assert.match(departureReminderBackgroundPolicy(false), /not confirmed/i);
  assert.match(departureReminderBackgroundPolicy(false), /scale to zero/i);
  assert.match(departureReminderBackgroundPolicy(true), /explicitly configured/i);
});

test("concurrent VAPID bootstrap reads back one atomic singleton without rotation", async () => {
  let persisted: { publicKey: string; privateKey: string } | null = null;
  let generated = 0;
  const read = async () => persisted;
  const insert = async (keys: { publicKey: string; privateKey: string }) => {
    await Promise.resolve();
    if (persisted) return null;
    persisted = keys;
    return keys;
  };
  const generate = () => {
    generated += 1;
    return { publicKey: `public-${generated}`, privateKey: `private-${generated}` };
  };
  const [first, second] = await Promise.all([
    initializeSingletonVapidKeys(read, insert, generate),
    initializeSingletonVapidKeys(read, insert, generate),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(first, persisted);
});

test("VAPID bootstrap fails explicitly when conflict read-back is unavailable", async () => {
  await assert.rejects(
    initializeSingletonVapidKeys(
      async () => null,
      async () => null,
      () => ({ publicKey: "discarded", privateKey: "discarded" }),
    ),
    /Could not initialize push notifications/,
  );
});