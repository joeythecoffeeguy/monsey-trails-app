import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, mock, test } from "node:test";
import express from "express";
import { clerkClient } from "@clerk/express";
import { db, driverProfilesTable, liveTripsTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import router from "./index";

const busNumber = randomBytes(3).toString("hex").toUpperCase();
const driverSubject = `announcement-driver-${randomBytes(6).toString("hex")}`;
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
    id: driverSubject, username: "announcement-driver", banned: false, locked: false,
    privateMetadata: { role: "driver", driverAccess: true },
  }) as never);
  await db.insert(driverProfilesTable).values({
    clerkSubject: driverSubject, username: "announcement-driver", usernameKey: "announcement-driver",
    unitNumber: "test", phoneNumber: "+18455550123",
  });
  await db.insert(liveTripsTable).values({
    pairingCode: busNumber,
    ownerSubject: driverSubject,
    officialRunKey: "2026-09-22|2|2|3|announcement-test",
    scheduledDepartureAt: new Date("2026-09-22T12:00:00.000Z"),
    status: "ready",
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  mock.restoreAll();
  await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  await db.delete(driverProfilesTable).where(eq(driverProfilesTable.clerkSubject, driverSubject));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("added and deleted announcements synchronize through the shared coach session", async () => {
  const connection = await request("/trips", {
    method: "POST",
    body: JSON.stringify({ busNumber }),
  });
  assert.equal(connection.status, 201);

  const announcement = {
    id: "service-message",
    title: "Service update",
    message: "The next stop has changed.",
    active: true,
  };
  const addedResponse = await request(`/trips/${busNumber}/announcements`, {
    method: "PATCH",
    body: JSON.stringify({ announcements: [announcement] }),
  });
  assert.equal(addedResponse.status, 200);

  const passengerPoll = await request(`/trips/${busNumber}`);
  const passengerTrip = await passengerPoll.json() as { announcements: unknown[] };
  assert.deepEqual(passengerTrip.announcements, [announcement]);

  const deletedResponse = await request(`/trips/${busNumber}/announcements`, {
    method: "PATCH",
    body: JSON.stringify({ announcements: [] }),
  });
  assert.equal(deletedResponse.status, 200);
  const deleted = await deletedResponse.json() as { announcements: unknown[] };
  assert.deepEqual(deleted.announcements, []);

  const optionalInfoResponse = await request(`/trips/${busNumber}/display-settings`, {
    method: "PATCH",
    body: JSON.stringify({
      routeId: "route-1",
      displayMode: "passenger-guide",
      passengerLanguage: "en",
      rotationIntervalSeconds: 15,
      arrivalSoundsEnabled: true,
    }),
  });
  assert.equal(optionalInfoResponse.status, 200);
  const optionalInfoTrip = await optionalInfoResponse.json() as { displayMode: string };
  assert.equal(optionalInfoTrip.displayMode, "passenger-guide");
});