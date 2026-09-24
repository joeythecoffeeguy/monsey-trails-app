import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, mock, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  liveTripsTable,
  passengerRealtimeDeliveriesTable,
  passengerRealtimeSubscriptionsTable,
  pool,
  serviceDisruptionsTable,
} from "@workspace/db";
import {
  disruptionEventKey,
  processDuePassengerRealtimePushes,
  processDuePassengerRealtimeReceipts,
  revokePassengerRealtimeSubscriptions,
  sendPassengerRealtimePush,
} from "../lib/passenger-realtime";
import { passengerRealtimeCapabilityHash, insertOrRefreshPassengerRealtimeSubscription } from "./passenger-realtime";

after(async () => {
  mock.restoreAll();
  await pool.end();
});

function testCodes() {
  return {
    pairingCode: randomBytes(3).toString("hex").toUpperCase(),
    passengerCode: String(1000 + Math.floor(Math.random() * 8999)),
    runKey: `2026-09-17|1|5|2|realtime-${randomBytes(4).toString("hex")}`,
  };
}

async function insertTrip(pairingCode: string, passengerCode: string, runKey: string) {
  await db.insert(liveTripsTable).values({
    pairingCode,
    passengerPairingCode: passengerCode,
    ownerSubject: `realtime-test-${randomUUID()}`,
    officialRunKey: runKey,
    status: "running",
    scheduledDepartureAt: new Date(Date.now() - 60_000),
  });
}

async function insertSubscription(input: {
  pairingCode: string;
  passengerCode: string;
  runKey: string;
  active?: boolean;
  id?: string;
  flow?: "disruption" | "approaching-pickup" | "transfer-risk";
}) {
  const id = input.id ?? randomUUID();
  const deviceId = `realtime-test-${randomUUID()}`;
  await db.insert(passengerRealtimeSubscriptionsTable).values({
    id,
    flow: input.flow ?? "disruption",
    deviceId,
    ownerCapabilityHash: passengerRealtimeCapabilityHash(randomBytes(32).toString("base64url")),
    passengerCode: input.passengerCode,
    operatorPairingCode: input.pairingCode,
    officialRunKey: input.runKey,
    expoPushToken: `ExponentPushToken[${randomUUID()}]`,
    active: input.active ?? true,
  });
  const [row] = await db.select().from(passengerRealtimeSubscriptionsTable)
    .where(eq(passengerRealtimeSubscriptionsTable.id, id)).limit(1);
  assert.ok(row);
  return row;
}

async function insertDisruption(runKey: string, updatedAt = new Date()) {
  const [row] = await db.insert(serviceDisruptionsTable).values({
    id: randomUUID(),
    officialRunKey: runKey,
    type: "delay",
    message: "Test service notice",
    startsAt: new Date(updatedAt.getTime() - 60_000),
    expiresAt: new Date(updatedAt.getTime() + 60 * 60_000),
    createdBy: "realtime-test",
    updatedAt,
  }).returning();
  return row;
}

async function cleanup(pairingCode: string, disruptionId?: string) {
  if (disruptionId) await db.delete(serviceDisruptionsTable).where(eq(serviceDisruptionsTable.id, disruptionId));
  await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, pairingCode));
}

test("passenger pairing rotation revokes subscriptions and pending sends in the database", async () => {
  const { pairingCode, passengerCode, runKey } = testCodes();
  await insertTrip(pairingCode, passengerCode, runKey);
  const subscription = await insertSubscription({ pairingCode, passengerCode, runKey });
  const deliveries = await db.insert(passengerRealtimeDeliveriesTable).values(
    (["pending", "sending", "receipt_pending"] as const).map(state => ({
      id: randomUUID(),
      subscriptionId: subscription.id,
      eventKey: `test-revoke-${state}`,
      payload: { title: "Test", body: "Test", screen: "trip" },
      expoPushToken: subscription.expoPushToken,
      expoTicketId: state === "receipt_pending" ? "test-ticket" : null,
      state,
    })),
  ).returning();
  try {
    assert.equal(await revokePassengerRealtimeSubscriptions(pairingCode, passengerCode), 1);
    const [revoked] = await db.select().from(passengerRealtimeSubscriptionsTable)
      .where(eq(passengerRealtimeSubscriptionsTable.id, subscription.id));
    const cancelled = await db.select().from(passengerRealtimeDeliveriesTable).where(inArray(
      passengerRealtimeDeliveriesTable.id, deliveries.map(row => row.id),
    ));
    assert.equal(revoked?.active, false);
    assert.equal(cancelled.length, 3);
    assert.ok(cancelled.every(row => row.state === "failed"));
  } finally {
    await cleanup(pairingCode);
  }
});

test("idempotent subscription POST persistence does not rearm a consumed opt-in", async () => {
  const { pairingCode, passengerCode, runKey } = testCodes();
  await insertTrip(pairingCode, passengerCode, runKey);
  const subscription = await insertSubscription({
    pairingCode, passengerCode, runKey, flow: "approaching-pickup", active: false,
  });
  try {
    const refreshed = await insertOrRefreshPassengerRealtimeSubscription({
      ...subscription,
      id: randomUUID(),
      active: true,
      expoPushToken: `ExponentPushToken[refresh-${randomUUID()}]`,
      soundEnabled: false,
      updatedAt: new Date(),
    });
    assert.equal(refreshed.id, subscription.id);
    assert.equal(refreshed.active, false);
    assert.equal(refreshed.soundEnabled, false);
    assert.equal(refreshed.expoPushToken.startsWith("ExponentPushToken[refresh-"), true);
  } finally {
    await cleanup(pairingCode);
  }
});

test("retry revalidates the current passenger code before reaching Expo", async () => {
  const { pairingCode, passengerCode, runKey } = testCodes();
  const currentPassengerCode = String(1000 + ((Number(passengerCode) + 1) % 8999));
  await insertTrip(pairingCode, currentPassengerCode, runKey);
  const subscription = await insertSubscription({ pairingCode, passengerCode, runKey });
  const disruption = await insertDisruption(runKey);
  const oldEvent = disruptionEventKey(
    disruption.id, "created", new Date(disruption.updatedAt.getTime() - 1_000),
  );
  const [delivery] = await db.insert(passengerRealtimeDeliveriesTable).values({
    id: randomUUID(),
    subscriptionId: subscription.id,
    eventKey: oldEvent,
    payload: { title: "Test", body: "Test", screen: "trip" },
    expoPushToken: subscription.expoPushToken,
    state: "pending",
  }).returning();
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("Stale delivery must not reach Expo.");
  });
  try {
    await processDuePassengerRealtimePushes();
    const [cancelled] = await db.select().from(passengerRealtimeDeliveriesTable)
      .where(eq(passengerRealtimeDeliveriesTable.id, delivery.id));
    assert.equal(cancelled?.state, "failed");
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
    await cleanup(pairingCode, disruption.id);
  }
});

test("retry cancels a disruption send after its stored revision changes", async () => {
  const { pairingCode, passengerCode, runKey } = testCodes();
  await insertTrip(pairingCode, passengerCode, runKey);
  const subscription = await insertSubscription({ pairingCode, passengerCode, runKey });
  const disruption = await insertDisruption(runKey);
  const oldEvent = disruptionEventKey(
    disruption.id, "created", new Date(disruption.updatedAt.getTime() - 1_000),
  );
  const [delivery] = await db.insert(passengerRealtimeDeliveriesTable).values({
    id: randomUUID(),
    subscriptionId: subscription.id,
    eventKey: oldEvent,
    payload: { title: "Test", body: "Test", screen: "trip" },
    expoPushToken: subscription.expoPushToken,
    state: "pending",
  }).returning();
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("Changed disruption must not reach Expo.");
  });
  try {
    await processDuePassengerRealtimePushes();
    const [cancelled] = await db.select().from(passengerRealtimeDeliveriesTable)
      .where(eq(passengerRealtimeDeliveriesTable.id, delivery.id));
    assert.equal(cancelled?.state, "failed");
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
    await cleanup(pairingCode, disruption.id);
  }
});

test("Expo ticket IDs are persisted and permanent receipt token errors disable the matching token", async () => {
  const { pairingCode, passengerCode, runKey } = testCodes();
  await insertTrip(pairingCode, passengerCode, runKey);
  const subscription = await insertSubscription({ pairingCode, passengerCode, runKey });
  const disruption = await insertDisruption(runKey);
  const eventKey = disruptionEventKey(disruption.id, "created", disruption.updatedAt);
  const ticketId = `ticket-${randomUUID()}`;
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).endsWith("/push/send")) {
      return new Response(JSON.stringify({ data: { status: "ok", id: ticketId } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      data: { [ticketId]: { status: "error", details: { error: "DeviceNotRegistered" } } },
    }), { status: 200 });
  });
  try {
    assert.equal(await sendPassengerRealtimePush(subscription, eventKey, {
      title: "Test notice", body: "A current notice", screen: "trip",
    }, { error: () => undefined }), true);
    const [pendingReceipt] = await db.select().from(passengerRealtimeDeliveriesTable).where(and(
      eq(passengerRealtimeDeliveriesTable.subscriptionId, subscription.id),
      eq(passengerRealtimeDeliveriesTable.eventKey, eventKey),
    ));
    assert.equal(pendingReceipt?.state, "receipt_pending");
    assert.equal(pendingReceipt?.expoTicketId, ticketId);
    assert.equal(pendingReceipt?.expoPushToken, subscription.expoPushToken);

    await db.update(passengerRealtimeDeliveriesTable).set({ nextReceiptCheckAt: new Date(0) })
      .where(eq(passengerRealtimeDeliveriesTable.id, pendingReceipt!.id));
    await processDuePassengerRealtimeReceipts(new Date(), { error: () => undefined });
    const [failedReceipt] = await db.select().from(passengerRealtimeDeliveriesTable)
      .where(eq(passengerRealtimeDeliveriesTable.id, pendingReceipt!.id));
    const [disabledSubscription] = await db.select().from(passengerRealtimeSubscriptionsTable)
      .where(eq(passengerRealtimeSubscriptionsTable.id, subscription.id));
    assert.equal(failedReceipt?.state, "failed");
    assert.match(failedReceipt?.receiptError ?? "", /DeviceNotRegistered/);
    assert.equal(disabledSubscription?.active, false);
    assert.equal(fetchMock.mock.callCount(), 2);
  } finally {
    fetchMock.mock.restore();
    await cleanup(pairingCode, disruption.id);
  }
});

test("transient Expo receipt errors stop after the bounded retry count", async () => {
  const { pairingCode, passengerCode, runKey } = testCodes();
  await insertTrip(pairingCode, passengerCode, runKey);
  const subscription = await insertSubscription({ pairingCode, passengerCode, runKey });
  const [delivery] = await db.insert(passengerRealtimeDeliveriesTable).values({
    id: randomUUID(),
    subscriptionId: subscription.id,
    eventKey: "transient-receipt",
    payload: { title: "Test", body: "Test", screen: "trip" },
    expoPushToken: subscription.expoPushToken,
    expoTicketId: `ticket-${randomUUID()}`,
    state: "receipt_pending",
    receiptAttempts: 5,
    nextReceiptCheckAt: new Date(0),
  }).returning();
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      data: { [delivery.expoTicketId!]: { status: "error", details: { error: "ExpoServerError" } } },
    }), { status: 200 }));
  try {
    await processDuePassengerRealtimeReceipts(new Date(), { error: () => undefined });
    const [terminal] = await db.select().from(passengerRealtimeDeliveriesTable)
      .where(eq(passengerRealtimeDeliveriesTable.id, delivery.id));
    const [stillActive] = await db.select().from(passengerRealtimeSubscriptionsTable)
      .where(eq(passengerRealtimeSubscriptionsTable.id, subscription.id));
    assert.equal(terminal?.state, "failed");
    assert.equal(terminal?.receiptAttempts, 6);
    assert.equal(stillActive?.active, true);
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fetchMock.mock.restore();
    await cleanup(pairingCode);
  }
});