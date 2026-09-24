import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, mock, test } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  liveTripsTable,
  passengerAlertsTable,
  pool,
} from "@workspace/db";
import app from "../app";
import { deliverPassengerAlerts, expirePassengerAlerts, reclaimStalePassengerAlerts } from "./passenger-alerts";

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
    server.once("error", reject);
  });
});

after(async () => {
  if (server.listening) await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("passenger pairing, snapshots, alert replacement/leave, and delivery ticket states", async () => {
  const pairingCode = randomBytes(3).toString("hex").toUpperCase();
  const passengerCode = String(1000 + Math.floor(Math.random() * 8999));
  const deviceId = `test-device-${randomUUID()}`;
  const stopId = "integration-stop";
  const tripEta = new Date(Date.now() + 60_000);
  const trip = {
    pairingCode,
    passengerPairingCode: passengerCode,
    ownerSubject: `alert-driver-${randomUUID()}`,
    officialRunKey: `2026-07-01|1|2|5|alert-${randomBytes(4).toString("hex")}`,
    scheduledDepartureAt: new Date(Date.now() - 60_000),
    status: "running" as const,
    destinationAddress: "Final destination",
    destinationLat: 40.01,
    destinationLng: -73.01,
    currentLat: 40,
    currentLng: -73,
    eta: tripEta,
    intermediateStops: [{
      id: stopId, address: "Selected stop", lat: 40.0001, lng: -73.0001,
      eta: new Date(Date.now() + 60_000).toISOString(),
    }],
  };

  await db.insert(liveTripsTable).values(trip);
  try {
    const pairResponse = await fetch(`${baseUrl}/passenger/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passengerCode }),
    });
    assert.equal(pairResponse.status, 200);
    const paired = await pairResponse.json() as {
      session: { operatorPairingCode: string };
      trip: { upcomingStops: Array<{ id: string }> };
    };
    assert.equal(paired.session.operatorPairingCode, pairingCode);
    assert.ok(paired.trip.upcomingStops.some((stop) => stop.id === stopId));
    assert.ok(paired.trip.upcomingStops.some((stop) => stop.id === "final-destination"));

    const snapshotResponse = await fetch(`${baseUrl}/passenger/snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passengerCode }),
    });
    assert.equal(snapshotResponse.status, 200);

    const alertBody = {
      passengerCode, deviceId, expoPushToken: "ExponentPushToken[integration-token]",
      selectedStopId: stopId, leadTime: "time-2m",
    };
    const firstAlert = await fetch(`${baseUrl}/passenger/alerts`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(alertBody),
    });
    assert.equal(firstAlert.status, 200);
    const first = await firstAlert.json() as { alert: { id: string } };

    const replacement = await fetch(`${baseUrl}/passenger/alerts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...alertBody, selectedStopId: "final-destination", leadTime: "time-15m", soundEnabled: false }),
    });
    assert.equal(replacement.status, 200);
    const [storedReplacement] = await db.select().from(passengerAlertsTable)
      .where(eq(passengerAlertsTable.id, first.alert.id));
    assert.equal(storedReplacement?.selectedStopId, "final-destination");
    assert.equal(storedReplacement?.leadTime, "time-15m");
    assert.equal(storedReplacement?.soundEnabled, false);

    const duplicate = await fetch(`${baseUrl}/passenger/alerts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...alertBody, selectedStopId: "final-destination", leadTime: "time-15m", soundEnabled: false }),
    });
    assert.equal(duplicate.status, 200);
    const duplicateBody = await duplicate.json() as { alert: { id: string; soundEnabled: boolean } };
    assert.equal(duplicateBody.alert.id, first.alert.id);
    assert.equal(duplicateBody.alert.soundEnabled, false);

    const invalidPreference = await fetch(`${baseUrl}/passenger/alerts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...alertBody, soundEnabled: "sometimes" }),
    });
    assert.equal(invalidPreference.status, 400);

    const leave = await fetch(`${baseUrl}/passenger/alerts`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passengerCode, deviceId }),
    });
    assert.equal(leave.status, 204);
    const afterLeave = await db.select().from(passengerAlertsTable)
      .where(eq(passengerAlertsTable.id, first.alert.id));
    assert.equal(afterLeave.length, 0);

    await db.insert(passengerAlertsTable).values({
      id: randomUUID(),
      operatorPairingCode: pairingCode,
      passengerCode,
      deviceId,
      expoPushToken: "ExponentPushToken[integration-token]",
      selectedStopId: stopId,
      leadTime: "time-2m",
    });
    const [storedTrip] = await db.select().from(liveTripsTable)
      .where(eq(liveTripsTable.pairingCode, pairingCode));
    const log = { error: () => undefined };

    mock.method(globalThis, "fetch", async () => new Response(
      JSON.stringify({ data: { status: "error", message: "DeviceNotRegistered" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await deliverPassengerAlerts(pairingCode, storedTrip, log);
    let [pending] = await db.select().from(passengerAlertsTable)
      .where(and(eq(passengerAlertsTable.operatorPairingCode, pairingCode), eq(passengerAlertsTable.deviceId, deviceId)));
    assert.equal(pending?.state, "pending");
    mock.restoreAll();

    mock.method(globalThis, "fetch", async () => new Response(
      JSON.stringify({ data: { status: "ok", id: "ticket-id" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await deliverPassengerAlerts(pairingCode, storedTrip, log);
    [pending] = await db.select().from(passengerAlertsTable)
      .where(and(eq(passengerAlertsTable.operatorPairingCode, pairingCode), eq(passengerAlertsTable.deviceId, deviceId)));
    assert.equal(pending?.state, "delivered");
    assert.ok(pending?.deliveredAt);
    mock.restoreAll();

    // A relaunch replays the same persisted selection to make sure a registration still exists.
    // That must not rearm a one-shot alert that has already delivered.
    const restoreReplay = await fetch(`${baseUrl}/passenger/alerts`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ passengerCode, deviceId, expoPushToken: "ExponentPushToken[integration-token]", selectedStopId: stopId, leadTime: "time-2m" }),
    });
    assert.equal(restoreReplay.status, 200);
    const restoreReplayBody = await restoreReplay.json() as { alert: { state: string } };
    assert.equal(restoreReplayBody.alert.state, "delivered");
    const [afterReplay] = await db.select().from(passengerAlertsTable)
      .where(and(eq(passengerAlertsTable.operatorPairingCode, pairingCode), eq(passengerAlertsTable.deviceId, deviceId)));
    assert.equal(afterReplay?.state, "delivered");

    const pushCalls = mock.method(globalThis, "fetch", async () => new Response(
      JSON.stringify({ data: { status: "ok", id: "should-not-be-called" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await deliverPassengerAlerts(pairingCode, storedTrip, log);
    assert.equal(pushCalls.mock.callCount(), 0);
    mock.restoreAll();

    const raceAlertId = randomUUID();
    await db.insert(passengerAlertsTable).values({
      id: raceAlertId,
      operatorPairingCode: pairingCode,
      passengerCode,
      deviceId: `${deviceId}-race`,
      expoPushToken: "ExponentPushToken[integration-token]",
      selectedStopId: stopId,
      leadTime: "time-2m",
    });
    let releasePush!: () => void;
    let markPushStarted!: () => void;
    const pushStarted = new Promise<void>((resolve) => { markPushStarted = resolve; });
    const pushReleased = new Promise<void>((resolve) => { releasePush = resolve; });
    mock.method(globalThis, "fetch", async () => {
      markPushStarted();
      await pushReleased;
      return new Response(
        JSON.stringify({ data: { status: "ok", id: "racing-ticket" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const racingDelivery = deliverPassengerAlerts(pairingCode, storedTrip, log);
    await pushStarted;
    await expirePassengerAlerts(pairingCode, { ...storedTrip, status: "stopped" });
    releasePush();
    await racingDelivery;
    const [afterRace] = await db.select().from(passengerAlertsTable)
      .where(eq(passengerAlertsTable.id, raceAlertId));
    assert.equal(afterRace?.state, "expired");
    assert.equal(afterRace?.deliveredAt, null);
    mock.restoreAll();

    const staleAlertId = randomUUID();
    await db.insert(passengerAlertsTable).values({
      id: staleAlertId,
      operatorPairingCode: pairingCode,
      passengerCode,
      deviceId: `${deviceId}-stale`,
      expoPushToken: "ExponentPushToken[integration-token]",
      selectedStopId: stopId,
      leadTime: "time-2m",
      state: "sending",
      updatedAt: new Date(Date.now() - 60_000),
    });
    const recovered = await reclaimStalePassengerAlerts(pairingCode);
    assert.equal(recovered, 1);
    const [reclaimed] = await db.select().from(passengerAlertsTable)
      .where(eq(passengerAlertsTable.id, staleAlertId));
    assert.equal(reclaimed?.state, "pending");

    const freshAlertId = randomUUID();
    await db.insert(passengerAlertsTable).values({
      id: freshAlertId,
      operatorPairingCode: pairingCode,
      passengerCode,
      deviceId: `${deviceId}-fresh`,
      expoPushToken: "ExponentPushToken[integration-token]",
      selectedStopId: stopId,
      leadTime: "time-2m",
      state: "sending",
      updatedAt: new Date(),
    });
    const notRecovered = await reclaimStalePassengerAlerts(pairingCode);
    assert.equal(notRecovered, 0);
    const [untouched] = await db.select().from(passengerAlertsTable)
      .where(eq(passengerAlertsTable.id, freshAlertId));
    assert.equal(untouched?.state, "sending");
  } finally {
    mock.restoreAll();
    await db.delete(passengerAlertsTable).where(eq(passengerAlertsTable.operatorPairingCode, pairingCode));
    await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, pairingCode));
  }
});