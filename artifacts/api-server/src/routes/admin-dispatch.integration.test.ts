import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import {
  db,
  dispatchAssignmentsTable,
  driverProfilesTable,
  liveTripsTable,
  passengerAlertsTable,
  pool,
  scheduledStopChangesTable,
  scheduleStopOverridesTable,
  serviceDisruptionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import adminDriversRouter from "./admin-drivers";
import adminStopsRouter from "./admin-stops";
import adminDisruptionsRouter from "./admin-disruptions";
import { activeServiceDisruptions } from "../lib/service-disruptions";
import { clearOfficialScheduleCachesForTest, integratedScheduleStops, scheduleStopKey } from "./schedule";
import { assignOfficialRun } from "../lib/official-run-assignment";

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const admins: string[] = [randomUUID(), randomUUID()];
const drivers: string[] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const buses = Array.from({ length: 10 }, () => randomBytes(3).toString("hex").toUpperCase());
const mutatedStopKeys: string[] = [];
const disruptionIds: string[] = [];
const serviceDate = "2026-09-22";
const runKeys = [
  `${serviceDate}|2|2|3|700`,
  `${serviceDate}|2|2|3|701`,
  `${serviceDate}|2|2|3|702`,
];
let server: Server;
let baseUrl: string;

function request(
  path: string,
  admin: string,
  method = "GET",
  body?: unknown,
) {
  return originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-user": admin,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function confirmedStopChange(
  admin: string,
  kind: "create" | "update" | "delete",
  change: Record<string, unknown>,
  key?: string,
) {
  const response = await request("/admin/schedule-stops/impact", admin, "POST", {
    kind,
    ...(key ? { key } : {}),
    change,
  });
  assert.equal(response.status, 200);
  const impact = await response.json() as { revision: string };
  assert.equal(impact.revision.length, 64);
  return impact.revision;
}

function publishedSchedule() {
  return {
    origin: "Monsey",
    origin_id: 2,
    destination: "Boro Park",
    destination_id: 3,
    schedule: [
      {
        schedule_busroute_id: 700,
        first_time: "08:00:00",
        time: "08:00:00",
        arrival: "09:00:00",
        duration: 60,
        busroute: {
          id: 70,
          route_code: "B2",
          route_symbol: "2",
          route_symbol2: "",
          direction: "outgoing",
          description: "Maple Avenue in front of the nursing home",
          description2: "Along 50th St",
        },
      },
      {
        schedule_busroute_id: 702,
        first_time: "12:00:00",
        time: "12:00:00",
        arrival: null,
        duration: null,
        busroute: {
          id: 72,
          route_code: "B2",
          route_symbol: "2",
          route_symbol2: "",
          direction: "outgoing",
          description: "Maple Avenue in front of the nursing home",
          description2: "Along 50th St",
        },
      },
      {
        schedule_busroute_id: 701,
        first_time: "10:00:00",
        time: "10:00:00",
        arrival: "11:00:00",
        duration: 60,
        busroute: {
          id: 71,
          route_code: "B2",
          route_symbol: "2",
          route_symbol2: "",
          direction: "outgoing",
          description: "Maple Avenue in front of the nursing home",
          description2: "Along 50th St",
        },
      },
    ],
  };
}

before(async () => {
  mock.method(clerkClient.sessions, "getSession", async (sessionId: string) => ({
    id: sessionId,
    userId: sessionId.replace(/^sess_/, ""),
    status: "active",
  }) as never);
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId,
    username: userId,
    banned: false,
    locked: false,
    privateMetadata: {
      role: admins.includes(userId) ? "admin" : "driver",
      ...(drivers.includes(userId) ? { driverAccess: true } : {}),
    },
  }) as never);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/")) {
      return new Response('<meta name="csrf-token" content="dispatch-test-token">', {
        status: 200,
        headers: { "set-cookie": "session=dispatch-test; Path=/" },
      });
    }
    if (url.endsWith("/ajax/schedule")) {
      return new Response(JSON.stringify(publishedSchedule()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  await db.insert(driverProfilesTable).values(drivers.map((subject, index) => ({
    clerkSubject: subject,
    username: `dispatch-${index}-${subject.slice(0, 8)}`,
    usernameKey: `dispatch-${index}-${subject.slice(0, 8)}`,
    unitNumber: String(index),
    phoneNumber: "+18455550123",
  })));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = typeof req.headers["x-test-user"] === "string" ? req.headers["x-test-user"] : null;
    Object.assign(req, {
      auth: Object.assign(() => ({
        userId,
        sessionId: userId ? `sess_${userId}` : null,
        tokenType: "session_token",
        sessionClaims: { role: "admin" },
      }), { [Symbol.for("@clerk/express.auth")]: true }),
      log: { info() {}, warn() {}, error() {} },
    });
    next();
  });
  app.use("/api", adminDriversRouter);
  app.use("/api", adminStopsRouter);
  app.use("/api", adminDisruptionsRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
  });
});

after(async () => {
  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  clearOfficialScheduleCachesForTest();
  mock.restoreAll();
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  await db.delete(dispatchAssignmentsTable).where(inArray(dispatchAssignmentsTable.busNumber, buses));
  await db.delete(liveTripsTable).where(inArray(liveTripsTable.pairingCode, buses));
  await db.delete(scheduledStopChangesTable).where(inArray(scheduledStopChangesTable.requestedBy, admins));
  if (mutatedStopKeys.length) {
    await db.delete(scheduleStopOverridesTable).where(inArray(scheduleStopOverridesTable.key, mutatedStopKeys));
  }
  if (disruptionIds.length) {
    await db.delete(serviceDisruptionsTable).where(inArray(serviceDisruptionsTable.id, disruptionIds));
  }
  await db.delete(driverProfilesTable).where(inArray(driverProfilesTable.clerkSubject, drivers));
  await pool.end();
});

test("dispatch can publish, edit, expire, and softly clear structured trip disruptions", async () => {
  Date.now = () => Date.parse("2026-09-22T12:00:00.000Z");
  const unauthorized = await request("/admin/service-disruptions", drivers[0], "POST", {
    officialRunKey: runKeys[0],
    type: "delay",
    message: "Traffic is adding time.",
    delayMinutes: 15,
    expiresAt: "2026-09-22T14:00:00.000Z",
  });
  assert.equal(unauthorized.status, 403);

  const unsafe = await request("/admin/service-disruptions", admins[0], "POST", {
    officialRunKey: runKeys[0],
    type: "detour",
    message: "<b>Use another road</b>",
    expiresAt: "2026-09-22T14:00:00.000Z",
  });
  assert.equal(unsafe.status, 400);

  const createdResponse = await request("/admin/service-disruptions", admins[0], "POST", {
    officialRunKey: runKeys[0],
    type: "skipped_stop",
    message: "Board at the following stop instead.",
    stopName: "Maple Avenue",
    expiresAt: "2026-09-22T14:00:00.000Z",
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: string; message: string };
  disruptionIds.push(created.id);
  const disruptionNow = new Date(Date.now());
  assert.equal((await activeServiceDisruptions(runKeys[0], disruptionNow)).length, 1);

  const updatedResponse = await request(`/admin/service-disruptions/${created.id}`, admins[1], "PUT", {
    officialRunKey: runKeys[0],
    type: "delay",
    message: "Traffic is adding about twenty minutes.",
    delayMinutes: 20,
    expiresAt: "2026-09-22T15:00:00.000Z",
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json() as { delayMinutes: number }).delayMinutes, 20);

  assert.equal((await request(`/admin/service-disruptions/${created.id}`, admins[0], "DELETE")).status, 204);
  assert.equal((await activeServiceDisruptions(runKeys[0], disruptionNow)).length, 0);
  const [retained] = await db.select().from(serviceDisruptionsTable)
    .where(eq(serviceDisruptionsTable.id, created.id));
  assert.ok(retained.clearedAt, "clear retains an auditable row");
});

test("admin stop categories persist on create and category-only edit", async () => {
  assert.equal((await request("/admin/schedule-stops", drivers[0])).status, 403);

  const invalid = await request("/admin/schedule-stops", admins[0], "POST", {
    areaId: 2,
    canonicalLabel: "Invalid Category Stop",
    lat: 41.1,
    lng: -74.1,
    category: "boarding",
  });
  assert.equal(invalid.status, 400);

  const createChange = {
    areaId: 2,
    canonicalLabel: "Category Persistence Stop",
    address: "Category Persistence Stop, Monsey, NY",
    lat: 41.10987,
    lng: -74.10987,
    category: "pickup",
  };
  const created = await request("/admin/schedule-stops", admins[0], "POST", {
    ...createChange,
    confirmedImpactRevision: await confirmedStopChange(admins[0], "create", createChange),
  });
  assert.equal(created.status, 201);
  const pickup = await created.json() as { key: string; category: string; lat: number; lng: number };
  mutatedStopKeys.push(pickup.key);
  assert.equal(pickup.category, "pickup");

  const categoryChange = { category: "dropoff" };
  const updated = await request(
    `/admin/schedule-stops/${encodeURIComponent(pickup.key)}`,
    admins[0],
    "PUT",
    {
      ...categoryChange,
      confirmedImpactRevision: await confirmedStopChange(admins[0], "update", categoryChange, pickup.key),
    },
  );
  assert.equal(updated.status, 200);
  const dropoff = await updated.json() as { category: string; lat: number; lng: number };
  assert.equal(dropoff.category, "dropoff");
  assert.equal(dropoff.lat, pickup.lat);
  assert.equal(dropoff.lng, pickup.lng);

  const [stored] = await db.select().from(scheduleStopOverridesTable)
    .where(eq(scheduleStopOverridesTable.key, pickup.key));
  assert.equal(stored.category, "dropoff");

  const listed = await request("/admin/schedule-stops", admins[0]);
  assert.equal(listed.status, 200);
  const listedStop = (await listed.json() as Array<{ key: string; category: string }>)
    .find(stop => stop.key === pickup.key);
  assert.equal(listedStop?.category, "dropoff");

  const invalidUpdate = await request(
    `/admin/schedule-stops/${encodeURIComponent(pickup.key)}`,
    admins[0],
    "PUT",
    { category: "boarding" },
  );
  assert.equal(invalidUpdate.status, 400);
});

test("dispatch assignments stay exclusive and release only when safe", async () => {
  Date.now = () => Date.parse("2026-09-22T11:30:00.000Z");
  const concurrent = await Promise.all([
    request("/admin/dispatch-assignments", admins[0], "POST", {
      busNumber: buses[0],
      driverId: drivers[0],
      officialRunKey: runKeys[0],
    }),
    request("/admin/dispatch-assignments", admins[1], "POST", {
      busNumber: buses[1],
      driverId: drivers[1],
      officialRunKey: runKeys[0],
    }),
  ]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 409]);
  const winnerIndex = concurrent.findIndex(response => response.status === 201);
  const winnerBus = buses[winnerIndex];
  const winnerDriver = drivers[winnerIndex];
  const otherBus = buses[1 - winnerIndex];
  const otherDriver = drivers[1 - winnerIndex];

  const driverConflict = await request("/admin/dispatch-assignments", admins[0], "POST", {
    busNumber: otherBus,
    driverId: winnerDriver,
    officialRunKey: runKeys[1],
  });
  assert.equal(driverConflict.status, 409);
  assert.match((await driverConflict.json() as { error: string }).error, /driver is already assigned/i);

  const reassigned = await request("/admin/dispatch-assignments", admins[1], "POST", {
    busNumber: winnerBus,
    driverId: otherDriver,
    officialRunKey: runKeys[1],
  });
  assert.equal(reassigned.status, 201);
  const [reassignedRow] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, winnerBus));
  assert.equal(reassignedRow.ownerSubject, otherDriver);
  assert.equal(reassignedRow.officialRunKey, runKeys[1]);
  const reassignmentHistory = await db.select().from(dispatchAssignmentsTable)
    .where(eq(dispatchAssignmentsTable.busNumber, winnerBus));
  assert.equal(reassignmentHistory.length, 2);
  assert.deepEqual(
    reassignmentHistory.map(row => row.outcome).sort(),
    ["active", "reassigned"],
  );
  assert.equal(reassignmentHistory.filter(row => row.endedAt === null).length, 1);

  await db.update(liveTripsTable).set({ status: "running", completedAt: null })
    .where(eq(liveTripsTable.pairingCode, winnerBus));
  const runningCoachConflict = await request("/admin/dispatch-assignments", admins[0], "POST", {
    busNumber: winnerBus,
    driverId: winnerDriver,
    officialRunKey: runKeys[0],
  });
  assert.equal(runningCoachConflict.status, 409);
  assert.match((await runningCoachConflict.json() as { error: string }).error, /coach is currently driving/i);

  const unassignRunning = await request(
    `/admin/dispatch-assignments/${winnerBus}`,
    admins[0],
    "DELETE",
  );
  assert.equal(unassignRunning.status, 409);
  assert.match((await unassignRunning.json() as { error: string }).error, /in progress cannot be unassigned/i);

  await db.update(liveTripsTable).set({
    status: "ready",
    officialRunKey: runKeys[0],
    scheduledDepartureAt: new Date("2026-09-22T12:00:00.000Z"),
    ownerSubject: winnerDriver,
    completedAt: null,
  }).where(eq(liveTripsTable.pairingCode, winnerBus));

  Date.now = () => Date.parse("2026-09-22T13:29:59.000Z");
  assert.equal((await request("/admin/dispatch-assignments", admins[0])).status, 200);
  let [ready] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, winnerBus));
  assert.equal(ready.status, "ready");
  assert.equal(ready.completedAt, null);
  assert.equal(ready.ownerSubject, winnerDriver);

  Date.now = () => Date.parse("2026-09-22T13:30:00.000Z");
  assert.equal((await request("/admin/dispatch-assignments", admins[1])).status, 200);
  [ready] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, winnerBus));
  assert.equal(ready.status, "stopped");
  assert.ok(ready.completedAt);
  assert.equal(ready.ownerSubject, null);
  const expiredHistory = await db.select().from(dispatchAssignmentsTable)
    .where(eq(dispatchAssignmentsTable.busNumber, winnerBus));
  assert.equal(expiredHistory.filter(row => row.outcome === "expired").length, 1);
  assert.equal(expiredHistory.filter(row => row.endedAt === null).length, 0);

  await db.insert(liveTripsTable).values({
    pairingCode: buses[6],
    ownerSubject: drivers[0],
    officialRunKey: runKeys[2],
    scheduledDepartureAt: new Date("2026-09-22T16:00:00.000Z"),
    status: "ready",
  });
  await db.insert(dispatchAssignmentsTable).values({
    busNumber: buses[6],
    driverSubject: drivers[0],
    officialRunKey: runKeys[2],
    serviceDate,
    direction: "Monsey → Boro Park",
    scheduledDepartureAt: new Date("2026-09-22T16:00:00.000Z"),
  });
  assert.equal((await request(
    `/admin/dispatch-assignments/${buses[6]}`,
    admins[0],
    "DELETE",
  )).status, 204);
  assert.equal((await request(
    `/admin/dispatch-assignments/${buses[6]}`,
    admins[0],
    "DELETE",
  )).status, 404);
  const [releasedLive] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, buses[6]));
  assert.equal(releasedLive.status, "idle");
  assert.equal(releasedLive.ownerSubject, null);
  const releasedHistory = await db.select().from(dispatchAssignmentsTable)
    .where(eq(dispatchAssignmentsTable.busNumber, buses[6]));
  assert.equal(releasedHistory.length, 1);
  assert.equal(releasedHistory[0].outcome, "released");
  assert.ok(releasedHistory[0].endedAt);

  const sameDriver = await Promise.all([
    request("/admin/dispatch-assignments", admins[0], "POST", {
      busNumber: buses[2],
      driverId: drivers[2],
      officialRunKey: runKeys[0],
    }),
    request("/admin/dispatch-assignments", admins[1], "POST", {
      busNumber: buses[3],
      driverId: drivers[2],
      officialRunKey: runKeys[1],
    }),
  ]);
  assert.deepEqual(
    sameDriver.map(response => response.status).sort(),
    [201, 409],
    "different run locks must still serialize assignments for the same driver",
  );

  await db.insert(liveTripsTable).values({
    pairingCode: buses[4],
    ownerSubject: drivers[3],
  });
  const [operatorCoach] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, buses[4]));
  const crossPathRace = await Promise.allSettled([
    assignOfficialRun(
      buses[4],
      drivers[3],
      operatorCoach.updatedAt,
      {
        officialRunKey: runKeys[2],
        scheduledDepartureAt: new Date("2026-09-22T16:00:00.000Z"),
        status: "ready",
        completedAt: null,
      },
    ),
    request("/admin/dispatch-assignments", admins[0], "POST", {
      busNumber: buses[5],
      driverId: drivers[3],
      officialRunKey: runKeys[2],
    }).then(async response => {
      if (response.status !== 201) throw Object.assign(new Error("admin conflict"), { status: response.status });
      return response;
    }),
  ]);
  assert.equal(
    crossPathRace.filter(result => result.status === "fulfilled").length,
    1,
    "admin and operator assignment paths must share the same run lock",
  );
  const crossPathFailure = crossPathRace.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(crossPathFailure.reason.status, 409);

  await db.update(liveTripsTable).set({
    status: "ready",
    officialRunKey: runKeys[2],
    scheduledDepartureAt: new Date("2026-09-22T16:00:00.000Z"),
    ownerSubject: drivers[0],
    completedAt: null,
  }).where(eq(liveTripsTable.pairingCode, winnerBus));
  Date.now = () => Date.parse("2026-09-24T23:59:59.000Z");
  assert.equal((await request("/admin/dispatch-assignments", admins[0])).status, 200);
  const [unverifiedArrival] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, winnerBus));
  assert.equal(unverifiedArrival.status, "ready");
  assert.equal(unverifiedArrival.completedAt, null);
  assert.equal(unverifiedArrival.ownerSubject, drivers[0]);
});

test("an administrator can start an assigned trip and stopping removes all passenger location", async () => {
  const busNumber = buses[7];
  const officialRunKey = `${serviceDate}|2|2|3|799`;
  const scheduledDepartureAt = new Date("2026-09-22T20:00:00.000Z");
  await db.insert(liveTripsTable).values({
    pairingCode: busNumber,
    ownerSubject: drivers[4],
    officialRunKey,
    scheduledDepartureAt,
    status: "ready",
    destinationAddress: "18th Avenue & 50th Street",
    destinationLat: 40.635,
    destinationLng: -73.99,
    intermediateStops: [
      { id: "official-799-1", address: "Maple Avenue", lat: 41.1, lng: -74.1 },
    ],
  });
  await db.insert(dispatchAssignmentsTable).values({
    busNumber,
    driverSubject: drivers[4],
    officialRunKey,
    serviceDate,
    direction: "Monsey → Boro Park",
    scheduledDepartureAt,
  });

  const started = await request(`/admin/active-trips/${busNumber}/start`, admins[0], "POST");
  assert.equal(started.status, 200);
  assert.deepEqual(await started.json(), {
    busNumber,
    status: "running",
    startedAt: (await db.select({ startedAt: liveTripsTable.startedAt }).from(liveTripsTable)
      .where(eq(liveTripsTable.pairingCode, busNumber)))[0].startedAt?.toISOString(),
    locationVisibility: "live",
  });

  await db.update(liveTripsTable).set({
    currentLat: 41.11,
    currentLng: -74.11,
    originLat: 41.1,
    originLng: -74.1,
    locationUpdatedAt: new Date(),
    routeGeometry: [{ lat: 41.11, lng: -74.11 }, { lat: 40.635, lng: -73.99 }],
  }).where(eq(liveTripsTable.pairingCode, busNumber));

  const stopped = await request(`/admin/active-trips/${busNumber}/stop`, admins[1], "POST");
  assert.equal(stopped.status, 200);
  assert.deepEqual(await stopped.json(), {
    busNumber,
    status: "stopped",
    startedAt: null,
    locationVisibility: "ended",
  });
  const [row] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, busNumber));
  assert.equal(row.currentLat, null);
  assert.equal(row.currentLng, null);
  assert.equal(row.locationUpdatedAt, null);
  assert.deepEqual(row.routeGeometry, []);
  assert.deepEqual(row.intermediateStops, []);
  assert.equal(row.destinationLat, null);
  assert.equal(row.destinationLng, null);
  assert.ok(row.completedAt);
  const [history] = await db.select().from(dispatchAssignmentsTable)
    .where(eq(dispatchAssignmentsTable.busNumber, busNumber));
  assert.equal(history.outcome, "completed");
  assert.ok(history.endedAt);
});

test("only an administrator can log out paired screens without changing the active trip", async () => {
  const busNumber = buses[9];
  const oldPairingCode = randomBytes(3).toString("hex").toUpperCase();
  const officialRunKey = `${serviceDate}|2|2|3|798`;
  const scheduledDepartureAt = new Date("2026-09-22T18:00:00.000Z");
  const startedAt = new Date("2026-09-22T18:05:00.000Z");
  const locationUpdatedAt = new Date("2026-09-22T18:30:00.000Z");
  const routeGeometry = [{ lat: 41.11, lng: -74.04 }, { lat: 40.64, lng: -73.99 }];
  const intermediateStops = [
    { id: "official-798-1", address: "Maple Avenue", lat: 41.1, lng: -74.1 },
  ];
  await db.insert(liveTripsTable).values({
    pairingCode: busNumber,
    passengerPairingCode: oldPairingCode,
    passengerLastSeenAt: new Date(),
    ownerSubject: drivers[5],
    officialRunKey,
    scheduledDepartureAt,
    status: "running",
    startedAt,
    destinationAddress: "18th Avenue & 50th Street",
    destinationLat: 40.635,
    destinationLng: -73.99,
    intermediateStops,
    currentLat: 41.11,
    currentLng: -74.04,
    originLat: 41.12,
    originLng: -74.05,
    speedMph: 37,
    remainingDistanceMiles: 22,
    routeGeometry,
    locationUpdatedAt,
  });
  await db.insert(dispatchAssignmentsTable).values({
    busNumber,
    driverSubject: drivers[5],
    officialRunKey,
    serviceDate,
    direction: "Monsey → Boro Park",
    scheduledDepartureAt,
  });

  const unauthorized = await request(
    `/admin/active-trips/${busNumber}/disconnect-screens`,
    drivers[0],
    "POST",
  );
  assert.equal(unauthorized.status, 403);

  const response = await request(
    `/admin/active-trips/${busNumber}/disconnect-screens`,
    admins[0],
    "POST",
  );
  assert.equal(response.status, 200);
  const body = await response.json() as {
    busNumber: string;
    pairingCode: string;
    pairedScreenCount: number;
    status: string;
    officialRunKey: string | null;
    startedAt: string | null;
  };
  assert.equal(body.busNumber, busNumber);
  assert.notEqual(body.pairingCode, oldPairingCode);
  assert.equal(body.pairedScreenCount, 0);
  assert.equal(body.status, "running");
  assert.equal(body.officialRunKey, officialRunKey);
  assert.equal(body.startedAt, startedAt.toISOString());

  const [preserved] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, busNumber));
  assert.notEqual(preserved.passengerPairingCode, oldPairingCode);
  assert.equal(preserved.passengerLastSeenAt, null);
  assert.equal(preserved.ownerSubject, drivers[5]);
  assert.equal(preserved.officialRunKey, officialRunKey);
  assert.equal(preserved.scheduledDepartureAt?.toISOString(), scheduledDepartureAt.toISOString());
  assert.equal(preserved.status, "running");
  assert.equal(preserved.startedAt?.toISOString(), startedAt.toISOString());
  assert.equal(preserved.currentLat, 41.11);
  assert.equal(preserved.currentLng, -74.04);
  assert.equal(preserved.originLat, 41.12);
  assert.equal(preserved.originLng, -74.05);
  assert.equal(preserved.locationUpdatedAt?.toISOString(), locationUpdatedAt.toISOString());
  assert.equal(preserved.remainingDistanceMiles, 22);
  assert.deepEqual(preserved.routeGeometry, routeGeometry);
  assert.deepEqual(preserved.intermediateStops, intermediateStops);

  const [assignment] = await db.select().from(dispatchAssignmentsTable)
    .where(eq(dispatchAssignmentsTable.busNumber, busNumber));
  assert.equal(assignment.endedAt, null);
  assert.equal(assignment.outcome, "active");
  await db.delete(dispatchAssignmentsTable).where(eq(dispatchAssignmentsTable.busNumber, busNumber));
  await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
});

test("custom and removed official stops reconcile across active trips without stopping website sync", async () => {
  const busNumber = buses[8];
  await db.insert(liveTripsTable).values({
    pairingCode: busNumber,
    ownerSubject: drivers[5],
    officialRunKey: runKeys[0],
    scheduledDepartureAt: new Date("2026-09-22T12:00:00.000Z"),
    status: "ready",
    destinationAddress: "18th Avenue & 50th Street",
    destinationLat: 40.635,
    destinationLng: -73.99,
  });

  const customChange = {
    areaId: 2,
    canonicalLabel: "Test Custom Stop",
    address: "Test Custom Stop, Monsey, NY",
    lat: 41.12345,
    lng: -74.12345,
  };
  const created = await request("/admin/schedule-stops", admins[0], "POST", {
    ...customChange,
    confirmedImpactRevision: await confirmedStopChange(admins[0], "create", customChange),
  });
  assert.equal(created.status, 201);
  const custom = await created.json() as { key: string; isCustom: boolean; listedOnOfficialSite: boolean };
  mutatedStopKeys.push(custom.key);
  assert.equal(custom.isCustom, true);
  assert.equal(custom.listedOnOfficialSite, false);
  let [trip] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, busNumber));
  assert.ok(trip.intermediateStops.some(stop => stop.id === `custom-${custom.key}`));
  const alertId = randomUUID();
  await db.insert(passengerAlertsTable).values({
    id: alertId,
    operatorPairingCode: busNumber,
    passengerCode: "1234",
    deviceId: randomUUID(),
    expoPushToken: "ExponentPushToken[custom-stop-test]",
    selectedStopId: `custom-${custom.key}`,
    leadTime: "time-2m",
  });

  assert.equal((await request(
    `/admin/schedule-stops/${encodeURIComponent(custom.key)}?confirmedImpactRevision=${await confirmedStopChange(admins[0], "delete", {}, custom.key)}`,
    admins[0],
    "DELETE",
  )).status, 204);
  [trip] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, busNumber));
  assert.equal(trip.intermediateStops.some(stop => stop.id === `custom-${custom.key}`), false);
  const [expiredAlert] = await db.select().from(passengerAlertsTable)
    .where(eq(passengerAlertsTable.id, alertId));
  assert.equal(expiredAlert.state, "expired");

  const official = integratedScheduleStops().find(stop =>
    stop.areaId === 2 && stop.sourceLabel === "Maple Avenue in front of the nursing home");
  assert.ok(official);
  const officialKey = scheduleStopKey(official.areaId, official.canonicalLabel);
  mutatedStopKeys.push(officialKey);
  const removedOfficial = await request(
    `/admin/schedule-stops/${encodeURIComponent(officialKey)}?confirmedImpactRevision=${await confirmedStopChange(admins[1], "delete", {}, officialKey)}`,
    admins[1],
    "DELETE",
  );
  assert.equal(removedOfficial.status, 204);
  const listed = await request("/admin/schedule-stops", admins[0]);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json() as Array<{ key: string }>).some(stop => stop.key === officialKey), false);
  [trip] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, busNumber));
  assert.equal(trip.intermediateStops.some(stop =>
    stop.address === official.canonicalLabel || stop.address === official.sourceLabel), false);

  await db.update(liveTripsTable).set({
    status: "running",
    intermediateStops: [],
    routeGeometry: [{ lat: 41.1, lng: -74.1 }, { lat: trip.destinationLat!, lng: trip.destinationLng! }],
  }).where(eq(liveTripsTable.pairingCode, busNumber));
  const destinationCustomChange = {
    areaId: 3,
    canonicalLabel: "Test Destination Area Stop",
    address: "Test Destination Area Stop, Brooklyn, NY",
    lat: 40.64,
    lng: -73.995,
  };
  const destinationCustomResponse = await request("/admin/schedule-stops", admins[0], "POST", {
    ...destinationCustomChange,
    confirmedImpactRevision: await confirmedStopChange(admins[0], "create", destinationCustomChange),
  });
  assert.equal(destinationCustomResponse.status, 201);
  const destinationCustom = await destinationCustomResponse.json() as { key: string };
  mutatedStopKeys.push(destinationCustom.key);
  [trip] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, busNumber));
  assert.deepEqual(trip.intermediateStops, [], "a running coach route is not rewritten");
  assert.deepEqual(trip.routeGeometry, [
    { lat: 41.1, lng: -74.1 },
    { lat: trip.destinationLat!, lng: trip.destinationLng! },
  ]);
  assert.equal((await request(
    `/admin/schedule-stops/${encodeURIComponent(destinationCustom.key)}?confirmedImpactRevision=${await confirmedStopChange(admins[0], "delete", {}, destinationCustom.key)}`,
    admins[0],
    "DELETE",
  )).status, 204);
  [trip] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, busNumber));
  assert.deepEqual(trip.intermediateStops, []);

  const activeDestination = integratedScheduleStops().find(stop =>
    stop.areaId === 3
    && (stop.canonicalLabel === trip.destinationAddress || stop.sourceLabel === trip.destinationAddress));
  assert.ok(activeDestination);
  const activeDestinationKey = scheduleStopKey(activeDestination.areaId, activeDestination.canonicalLabel);
  mutatedStopKeys.push(activeDestinationKey);
  const rejectedDestinationRemoval = await request(
    `/admin/schedule-stops/${encodeURIComponent(activeDestinationKey)}?confirmedImpactRevision=${await confirmedStopChange(admins[0], "delete", {}, activeDestinationKey)}`,
    admins[0],
    "DELETE",
  );
  assert.equal(rejectedDestinationRemoval.status, 409);
  const [unchangedDestination] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.pairingCode, busNumber));
  assert.equal(unchangedDestination.destinationAddress, trip.destinationAddress);
});

test("a due queued stop change applies atomically only once", async () => {
  const change = {
    areaId: 2,
    canonicalLabel: `Atomic Queue Stop ${randomBytes(4).toString("hex")}`,
    address: "Atomic Queue Stop, Monsey, NY",
    lat: 41.10876,
    lng: -74.10876,
    category: "both",
  };
  const confirmedImpactRevision = await confirmedStopChange(admins[0], "create", change);
  const queuedResponse = await request("/admin/scheduled-stop-changes", admins[0], "POST", {
    kind: "create",
    change,
    applyAt: new Date(new Date().getTime() + 120_000).toISOString(),
    confirmedImpactRevision,
  });
  assert.equal(queuedResponse.status, 201);
  const queued = await queuedResponse.json() as { change: { id: string } };
  await db.update(scheduledStopChangesTable).set({
    applyAt: new Date(new Date().getTime() - 1_000),
  }).where(eq(scheduledStopChangesTable.id, queued.change.id));

  const freshRevision = await confirmedStopChange(admins[0], "create", change);
  const results = await Promise.all([
    request(`/admin/scheduled-stop-changes/${queued.change.id}`, admins[0], "PATCH", {
      action: "applied",
      confirmedImpactRevision: freshRevision,
    }),
    request(`/admin/scheduled-stop-changes/${queued.change.id}`, admins[0], "PATCH", {
      action: "applied",
      confirmedImpactRevision: freshRevision,
    }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const saved = (await db.select().from(scheduleStopOverridesTable))
    .filter(row => row.canonicalLabel === change.canonicalLabel && !row.suppressed);
  assert.equal(saved.length, 1);
  mutatedStopKeys.push(saved[0].key);
});