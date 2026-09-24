import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { db, departureRemindersTable } from "@workspace/db";
import {
  ownerCapabilityHash,
  parseReminder,
  publicReminder,
  validServiceDate,
} from "./departure-reminders";
import departureRemindersRouter from "./departure-reminders";

const valid = {
  deviceId: "device-1",
  kind: "once",
  serviceDate: "2026-09-18",
  line: 1,
  origin: 1,
  destination: 2,
  runId: "published-run",
  delivery: { type: "expo", expoPushToken: "ExponentPushToken[test-token]" },
};

test("departure reminder input defaults to 15 minutes and validates recurring weekdays", () => {
  assert.equal(parseReminder(valid)?.leadMinutes, 15);
  assert.equal(parseReminder({ ...valid, kind: "weekly", weekdays: [] }), null);
  assert.deepEqual(
    parseReminder({ ...valid, kind: "weekly", weekdays: [5, 1, 5] })?.weekdays,
    [1, 5],
  );
  assert.equal(parseReminder({ ...valid, leadMinutes: 121 }), null);
  assert.equal(parseReminder({ ...valid, serviceDate: "2026-02-29" }), null);
  assert.equal(parseReminder({ ...valid, serviceDate: "2026-13-01" }), null);
  assert.equal(parseReminder({ ...valid, serviceDate: "2024-02-29" })?.serviceDate, "2024-02-29");
  assert.equal(validServiceDate("2026-04-31"), false);
});

test("installation ownership uses a one-way capability hash separate from public device ID", () => {
  const capability = "A".repeat(43);
  assert.equal(ownerCapabilityHash(capability).length, 64);
  assert.notEqual(ownerCapabilityHash(capability), capability);
  assert.notEqual(ownerCapabilityHash(capability), ownerCapabilityHash("B".repeat(43)));
});

test("list, final update lookup, and delete are scoped by installation capability", async () => {
  const id = randomUUID();
  const deviceId = `public-${randomUUID()}`;
  const owner = "A".repeat(43);
  const stranger = "B".repeat(43);
  const now = new Date();
  await db.insert(departureRemindersTable).values({
    id,
    deviceId,
    ownerCapabilityHash: ownerCapabilityHash(owner),
    kind: "once",
    serviceDate: "2026-09-18",
    line: 1,
    origin: 1,
    destination: 2,
    runId: "published-run",
    weekdays: [],
    leadMinutes: 15,
    channel: "expo",
    expoPushToken: "ExponentPushToken[test-token]",
    state: "active",
    nextCheckAt: now,
  });
  const app = express();
  app.use(express.json(), departureRemindersRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/passenger/departure-reminders`;
  const headers = (capability: string) => ({
    "content-type": "application/json",
    "x-departure-reminder-capability": capability,
  });
  try {
    const strangerList = await fetch(`${base}?deviceId=${encodeURIComponent(deviceId)}`, { headers: headers(stranger) });
    assert.equal(strangerList.status, 200);
    assert.deepEqual(await strangerList.json(), { reminders: [] });

    const ownerList = await fetch(`${base}?deviceId=${encodeURIComponent(deviceId)}`, { headers: headers(owner) });
    assert.equal(ownerList.status, 200);
    assert.equal((await ownerList.json() as { reminders: unknown[] }).reminders.length, 1);

    const wrongUpdate = await fetch(`${base}/${id}`, {
      method: "PUT",
      headers: headers(stranger),
      body: JSON.stringify({ ...valid, deviceId }),
    });
    assert.equal(wrongUpdate.status, 404);

    const wrongDelete = await fetch(`${base}/${id}`, { method: "DELETE", headers: headers(stranger) });
    assert.equal(wrongDelete.status, 404);
    assert.equal((await db.select().from(departureRemindersTable)
      .where(eq(departureRemindersTable.id, id))).length, 1);

    const ownerDelete = await fetch(`${base}/${id}`, { method: "DELETE", headers: headers(owner) });
    assert.equal(ownerDelete.status, 204);
    const [cancelled] = await db.select().from(departureRemindersTable)
      .where(eq(departureRemindersTable.id, id));
    assert.equal(cancelled.state, "cancelled");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    await db.delete(departureRemindersTable).where(eq(departureRemindersTable.id, id));
  }
});

test("public reminder responses never expose provider credentials", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const response = publicReminder({
    id: "00000000-0000-4000-8000-000000000000",
    deviceId: "device-1",
    ownerCapabilityHash: ownerCapabilityHash("A".repeat(43)),
    kind: "once",
    serviceDate: "2026-09-18",
    line: 1,
    origin: 1,
    destination: 2,
    runId: "published-run",
    weekdays: [],
    leadMinutes: 15,
    channel: "expo",
    expoPushToken: "ExponentPushToken[secret]",
    webEndpoint: null,
    webP256dh: null,
    webAuth: null,
    state: "cancelled",
    nextCheckAt: now,
    nextOccurrenceAt: null,
    nextOccurrenceServiceDate: null,
    lastOccurrenceDate: null,
    lastScheduledDepartureAt: null,
    lastNotifiedEventKey: null,
    failureCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal("expoPushToken" in response, false);
  assert.equal("ownerCapabilityHash" in response, false);
  assert.equal(response.state, "cancelled");
  assert.match(response.policy, /removed trips send a cancellation/i);
});