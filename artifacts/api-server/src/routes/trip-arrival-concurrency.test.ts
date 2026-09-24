import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, mock, test } from "node:test";
import express from "express";
import { clerkClient } from "@clerk/express";
import { db, dispatchAssignmentsTable, driverProfilesTable, liveTripsTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import router from "./index";

const busNumber = randomBytes(3).toString("hex").toUpperCase();
const driverSubject = `arrival-driver-${randomBytes(6).toString("hex")}`;
const driverUsername = `arrival-${randomBytes(5).toString("hex")}`;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  Object.assign(req, {
    auth: Object.assign(() => ({
      userId: driverSubject,
      sessionId: `sess_${driverSubject}`,
      tokenType: "session_token",
      sessionClaims: {},
    }), { [Symbol.for("@clerk/express.auth")]: true }),
    log: { error() {}, warn() {} },
  });
  next();
});
app.use("/api", router);
let server: Server;
let baseUrl: string;

function request(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

before(async () => {
  mock.method(clerkClient.sessions, "getSession", async () => ({
    userId: driverSubject, status: "active",
  }) as never);
  mock.method(clerkClient.users, "getUser", async () => ({
    id: driverSubject, username: driverUsername, banned: false, locked: false,
    privateMetadata: { role: "driver", driverAccess: true },
  }) as never);
  await db.insert(driverProfilesTable).values({
    clerkSubject: driverSubject, username: driverUsername, usernameKey: driverUsername,
    unitNumber: "test", phoneNumber: "+18455550123",
  });
  await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
    server.once("error", reject);
  });
});

after(async () => {
  mock.restoreAll();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await db.delete(dispatchAssignmentsTable).where(eq(dispatchAssignmentsTable.busNumber, busNumber));
  await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  await db.delete(driverProfilesTable).where(eq(driverProfilesTable.clerkSubject, driverSubject));
  await pool.end();
});

test("duplicate arrivals from two operator screens advance only the expected stop", async () => {
  const startedAt = new Date();
  const stops = [
    { id: "concurrent-stop-one", address: "First Street & Oak Avenue", lat: 40.71, lng: -74.006 },
    { id: "concurrent-stop-two", address: "Second Street & Pine Avenue", lat: 40.72, lng: -74.006 },
  ];
  await db.insert(liveTripsTable).values({
    pairingCode: busNumber,
    ownerSubject: driverSubject,
    status: "running",
    startedAt,
    officialRunKey: "2026-09-22|2|2|3|arrival",
    scheduledDepartureAt: new Date("2026-09-22T08:00:00.000Z"),
    destinationAddress: "Final Avenue & Terminal Road",
    destinationLat: 40.73,
    destinationLng: -74.006,
    intermediateStops: stops,
  });
  const connection = await request("/trips", {
    method: "POST",
    body: JSON.stringify({ busNumber }),
  });
  assert.equal(connection.status, 201);

  await db.insert(dispatchAssignmentsTable).values({
    busNumber,
    driverSubject,
    officialRunKey: "2026-09-22|2|2|3|arrival",
    serviceDate: "2026-09-22",
    direction: "Monsey → Boro Park",
    scheduledDepartureAt: new Date("2026-09-22T08:00:00.000Z"),
  });

  const arrivalRequest = () => request(`/trips/${busNumber}/arrive`, {
    method: "POST",
    body: JSON.stringify({
      expectedStopIdentity: stops[0].id,
      expectedStartedAt: startedAt.toISOString(),
    }),
  });
  const responses = await Promise.all([arrivalRequest(), arrivalRequest()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  let history = await db.select().from(dispatchAssignmentsTable)
    .where(eq(dispatchAssignmentsTable.busNumber, busNumber));
  assert.equal(history.length, 1);
  assert.equal(history[0].outcome, "active");
  assert.equal(history[0].endedAt, null);

  const currentResponse = await request(`/trips/${busNumber}`);
  const current = await currentResponse.json() as {
    intermediateStops: typeof stops;
  };
  assert.deepEqual(current.intermediateStops, [stops[1]]);

  const secondStop = await request(`/trips/${busNumber}/arrive`, {
    method: "POST",
    body: JSON.stringify({
      expectedStopIdentity: stops[1].id,
      expectedStartedAt: startedAt.toISOString(),
    }),
  });
  assert.equal(secondStop.status, 200);

  const finalArrivalRequest = () => request(`/trips/${busNumber}/arrive`, {
    method: "POST",
    body: JSON.stringify({
      expectedStopIdentity: "40.73:-74.006",
      expectedStartedAt: startedAt.toISOString(),
    }),
  });
  const finalResponses = await Promise.all([finalArrivalRequest(), finalArrivalRequest()]);
  assert.deepEqual(finalResponses.map((response) => response.status).sort(), [200, 409]);

  history = await db.select().from(dispatchAssignmentsTable)
    .where(eq(dispatchAssignmentsTable.busNumber, busNumber));
  assert.equal(history.length, 1);
  assert.equal(history[0].outcome, "completed");
  assert.ok(history[0].endedAt);
});