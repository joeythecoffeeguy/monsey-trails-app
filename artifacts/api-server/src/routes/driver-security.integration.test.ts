import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import { db, dispatchAssignmentsTable, driverProfilesTable, liveTripsTable, pool } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import router from "./index";
import { assignOfficialRun } from "../lib/official-run-assignment";

// Only this test harness supplies synthetic Clerk identities. Production always uses
// clerkMiddleware's verified cookie/session auth; there is no header-based auth there.
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const userId = typeof req.headers["x-test-driver"] === "string" ? req.headers["x-test-driver"] : null;
  Object.assign(req, {
    auth: Object.assign(() => ({
      userId,
      sessionId: userId ? `sess_${userId}` : null,
      tokenType: "session_token",
      sessionClaims: {
        username: userId ? `security-${userId.slice(0, 8)}` : undefined,
        role: req.headers["x-test-driver-access"] === "denied" ? "passenger" : "driver",
      },
    }), { [Symbol.for("@clerk/express.auth")]: true }),
    log: { error() {}, warn() {} },
  });
  next();
});
app.use("/api", router);
const subjects = [randomUUID(), randomUUID(), randomUUID()];

const deniedSubject = randomUUID();
const buses = Array.from({ length: 13 }, () => randomBytes(3).toString("hex").toUpperCase());
const passengerCode = String(Math.floor(1000 + Math.random() * 9000));
const routingOutagePassengerCode = String(Math.floor(1000 + Math.random() * 9000));
const runKey = `2026-07-01|1|2|5|security-${randomBytes(4).toString("hex")}`;
const originalFetch = globalThis.fetch;
let server: Server;
let baseUrl: string;
function request(path: string, subject?: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return originalFetch(`${baseUrl}${path}`, {
    method, headers: { "content-type": "application/json", ...(subject ? { "x-test-driver": subject } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

before(async () => {
  mock.method(clerkClient.sessions, "getSession", async (sessionId: string) => ({
    id: sessionId,
    userId: sessionId.replace(/^sess_/, ""),
    status: "active",
  }) as never);
  mock.method(clerkClient.users, "getUser", async (userId: string) => ({
    id: userId,
    username: `security-${userId.slice(0, 8)}`,
    banned: false,
    locked: false,
    privateMetadata: userId === deniedSubject ? { role: "passenger" } : { role: "driver", driverAccess: true },
  }) as never);
  await db.insert(driverProfilesTable).values(subjects.slice(0, 2).map((subject, i) => ({
    clerkSubject: subject, username: `security-${subject.slice(0, 8)}`,
    usernameKey: `security-${subject.slice(0, 8)}`, unitNumber: String(i), phoneNumber: "+18455550123",
  })));
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
  });
});
after(async () => {
  mock.restoreAll();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  await db.delete(dispatchAssignmentsTable).where(inArray(dispatchAssignmentsTable.busNumber, buses));
  await db.delete(liveTripsTable).where(inArray(liveTripsTable.pairingCode, buses));
  await db.delete(driverProfilesTable).where(inArray(driverProfilesTable.clerkSubject, subjects));
  await pool.end();
});

test("driver onboarding is required; profile is private and username is administrator-assigned", async () => {
  assert.equal((await request("/driver/profile")).status, 401);
  const unprovisioned = await request("/driver/profile", deniedSubject);
  assert.equal(unprovisioned.status, 403);
  assert.equal((await unprovisioned.json() as { code: string }).code, "DRIVER_ACCESS_REQUIRED");
  assert.equal((await request("/trips", undefined, "POST", { busNumber: buses[0] })).status, 401);
  assert.equal((await request("/trips", subjects[2], "POST", { busNumber: buses[0] })).status, 403);
  assert.deepEqual(await (await request("/driver/profile", subjects[2])).json(), { profile: null });
  const own = await (await request("/driver/profile", subjects[0])).json() as { profile: { username: string; unitNumber: string; phoneNumber: string } };
  assert.deepEqual(Object.keys(own.profile).sort(), ["phoneNumber", "unitNumber", "username"]);
  const attemptedRename = await request("/driver/profile", subjects[2], "PUT", {
    ...own.profile, username: own.profile.username.toUpperCase(),
  });
  assert.equal(attemptedRename.status, 200);
  const attemptedRenameBody = await attemptedRename.json() as {
    profile: { username: string; unitNumber: string; phoneNumber: string };
  };
  assert.deepEqual(attemptedRenameBody.profile, {
    username: `security-${subjects[2].slice(0, 8)}`,
    unitNumber: own.profile.unitNumber,
    phoneNumber: own.profile.phoneNumber,
  });
});

test("drivers cannot claim coaches and may connect only to their dispatch assignment", async () => {
  const createdAt = new Date("2020-01-01T00:00:00Z");
  await db.insert(liveTripsTable).values({ pairingCode: buses[0], createdAt });
  const claims = await Promise.all(subjects.slice(0, 2).map(s => request("/trips", s, "POST", { busNumber: buses[0] })));
  assert.deepEqual(claims.map(r => r.status), [403, 403]);
  await db.update(liveTripsTable).set({
    ownerSubject: subjects[0],
    status: "ready",
    officialRunKey: runKey,
    scheduledDepartureAt: new Date(Date.now() + 3600_000),
  }).where(eq(liveTripsTable.pairingCode, buses[0]));
  assert.equal((await request("/trips", subjects[0], "POST", { busNumber: buses[0] })).status, 201);
  assert.equal((await request("/trips", subjects[1], "POST", { busNumber: buses[0] })).status, 403);
  const [row] = await db.select().from(liveTripsTable).where(eq(liveTripsTable.pairingCode, buses[0]));
  assert.equal(row.createdAt.toISOString(), createdAt.toISOString());
  assert.equal((await request(`/trips/${buses[0]}`)).status, 401);
  assert.equal((await request(`/trips/${buses[0]}`, subjects[1])).status, 403);
  assert.equal((await request(`/trips/${buses[0]}/stop?viewer=passenger`, subjects[1], "POST")).status, 403);
  assert.equal((await request(`/trips/${buses[0]}/stop?viewer=passenger`, undefined, "POST")).status, 401);
  assert.equal((await request(`/trips/${row.passengerPairingCode}/navigation?viewer=passenger`)).status, 401);
});

test("every public snapshot redacts GPS and geometry before verified departure", async () => {
  await db.insert(liveTripsTable).values({
    pairingCode: buses[1], passengerPairingCode: passengerCode, ownerSubject: subjects[0],
    status: "running", officialRunKey: runKey, scheduledDepartureAt: new Date(Date.now() + 3600_000),
    currentLat: 41.123456, currentLng: -74.123456, originLat: 41.123456, originLng: -74.123456,
    speedMph: 35, routeGeometry: [{ lat: 41.123456, lng: -74.123456 }],
  });
  const responses = await Promise.all([
    request(`/trips/public/${buses[1]}`),
    request(`/trips/public-run/${encodeURIComponent(runKey)}`),
    request(`/trips/${passengerCode}?viewer=passenger&geometryVersion=anything`),
    request("/trips/pair", undefined, "POST", { pairingCode: passengerCode }),
    request("/passenger/pair", undefined, "POST", { passengerCode }),
    request("/passenger/snapshot", undefined, "POST", { passengerCode }),
    request(`/passenger/public-run/${encodeURIComponent(runKey)}`),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    const trip = body.trip ?? body;
    assert.equal(trip.locationVisibility, "before_departure");
    assert.equal(trip.currentLocation, null);
    assert.deepEqual(trip.routeGeometry, []);
    assert.equal(trip.origin, null);
    assert.equal(trip.speedMph, null);
    assert.equal(trip.bearing, null);
    assert.ok(trip.scheduledDepartureAt);
    const encoded = JSON.stringify(body);
    assert.ok(!encoded.includes("41.123456"));
    assert.ok(!encoded.includes(subjects[0]));
    assert.ok(!encoded.includes("phoneNumber"));
  }
  const geometry = await (await request(`/trips/${passengerCode}/route-geometry?viewer=passenger`)).json() as { geometry: unknown[] };
  assert.deepEqual(geometry.geometry, []);
});

test("trip startup keeps GPS when road routing fails and driver navigation retries independently", async () => {
  const busNumber = buses[12];
  const scheduledDepartureAt = new Date(Date.now() + 3600_000);
  const location = { lat: 41.109068, lng: -74.044419 };
  const updatedAt = new Date();
  await db.insert(liveTripsTable).values({
    pairingCode: busNumber,
    passengerPairingCode: routingOutagePassengerCode,
    ownerSubject: subjects[0],
    status: "ready",
    officialRunKey: `${runKey}-routing-outage`,
    scheduledDepartureAt,
    destinationAddress: "Published final stop",
    destinationLat: 41.138563,
    destinationLng: -74.082685,
    intermediateStops: [],
    updatedAt,
  });

  let roadRoutingCalls = 0;
  let navigationCalls = 0;
  let navigationAvailable = false;
  let releaseInitialRoadRoute!: () => void;
  const delayedRoadRouteFailure = new Promise<Response>((resolve) => {
    releaseInitialRoadRoute = () => resolve(new Response("unavailable", { status: 503 }));
  });
  const fetchMock = mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.startsWith("https://router.project-osrm.org/")) {
      roadRoutingCalls += 1;
      if (roadRoutingCalls === 1) return delayedRoadRouteFailure;
      return new Response("unavailable", { status: 503 });
    }
    if (!url.includes("api.tomtom.com/routing/")) {
      return new Response("not found", { status: 404 });
    }
    navigationCalls += 1;
    if (!navigationAvailable) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({
      routes: [{
        summary: {
          lengthInMeters: 5688,
          travelTimeInSeconds: 1061,
          noTrafficTravelTimeInSeconds: 848,
          trafficDelayInSeconds: 97,
          arrivalTime: "2026-09-22T15:09:12-04:00",
        },
        legs: [{
          points: [
            { latitude: location.lat, longitude: location.lng },
            { latitude: 41.138563, longitude: -74.082685 },
          ],
        }],
        guidance: { instructions: [] },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const originalTomTomKey = process.env.TOMTOM_API_KEY;
  process.env.TOMTOM_API_KEY = originalTomTomKey || "integration-test-key";
  try {
    const started = await request(`/trips/${busNumber}/start`, subjects[0], "POST", location);
    const startedTrip = await started.json() as Record<string, any>;
    assert.equal(started.status, 200, JSON.stringify(startedTrip));
    assert.equal(startedTrip.status, "running");
    assert.deepEqual(startedTrip.currentLocation, location);
    assert.deepEqual(startedTrip.routeGeometry, []);

    const [persisted] = await db.select().from(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
    assert.equal(persisted.status, "running");
    assert.equal(persisted.currentLat, location.lat);
    assert.equal(persisted.currentLng, location.lng);
    assert.ok(persisted.locationUpdatedAt);
    const initialLocationUpdatedAt = persisted.locationUpdatedAt;

    const passenger = await (await request(`/trips/public/${busNumber}`)).json() as Record<string, any>;
    assert.equal(passenger.locationVisibility, "before_departure");
    assert.equal(passenger.currentLocation, null);
    assert.deepEqual(passenger.routeGeometry, []);

    const unavailableNavigation = await request(`/trips/${busNumber}/navigation`, subjects[0]);
    assert.equal(unavailableNavigation.status, 502);

    const newerLocation = { lat: 41.1105, lng: -74.046, speedMph: 18 };
    const published = await request(`/trips/${busNumber}/location`, subjects[0], "POST", newerLocation);
    assert.equal(published.status, 200);
    const publishedTrip = await published.json() as Record<string, any>;
    assert.equal(publishedTrip.status, "running");
    assert.deepEqual(publishedTrip.currentLocation, { lat: newerLocation.lat, lng: newerLocation.lng });

    const [moved] = await db.select().from(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
    assert.equal(moved.status, "running");
    assert.equal(moved.currentLat, newerLocation.lat);
    assert.equal(moved.currentLng, newerLocation.lng);
    assert.notEqual(moved.locationUpdatedAt?.toISOString(), initialLocationUpdatedAt.toISOString());

    releaseInitialRoadRoute();
    navigationAvailable = true;
    const navigation = await request(`/trips/${busNumber}/navigation`, subjects[0]);
    assert.equal(navigation.status, 200);
    const navigationBody = await navigation.json() as { routeGeometry: unknown[] };
    assert.ok(navigationBody.routeGeometry.length > 0);
    assert.equal(roadRoutingCalls, 2);
    assert.equal(navigationCalls, 2);
  } finally {
    fetchMock.mock.restore();
    if (originalTomTomKey === undefined) delete process.env.TOMTOM_API_KEY;
    else process.env.TOMTOM_API_KEY = originalTomTomKey;
    await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  }
});

test("arrivals complete trips while screen disconnect and logout preserve dispatch ownership", async () => {
  const startedAt = new Date();
  await db.update(liveTripsTable).set({
    scheduledDepartureAt: new Date(Date.now() - 3600_000), startedAt,
    destinationLat: 40.7, destinationLng: -74, destinationAddress: "Published final stop", intermediateStops: [],
  }).where(eq(liveTripsTable.pairingCode, buses[1]));
  const live = await (await request(`/trips/public/${buses[1]}`)).json() as { locationVisibility: string };
  assert.equal(live.locationVisibility, "live");
  const disconnected = await request(`/trips/${buses[1]}/disconnect-screens`, subjects[0], "POST");
  assert.equal(disconnected.status, 200);
  const disconnectedBody = await disconnected.json() as {
    busNumber: string;
    pairingCode: string;
    trip: { status: string; officialRunKey: string | null; startedAt: string | null };
  };
  assert.equal(disconnectedBody.busNumber, buses[1]);
  assert.notEqual(disconnectedBody.pairingCode, passengerCode);
  assert.equal(disconnectedBody.trip.status, "running");
  assert.equal(disconnectedBody.trip.officialRunKey, runKey);
  assert.equal(disconnectedBody.trip.startedAt, startedAt.toISOString());
  assert.equal((await request(`/trips/${passengerCode}?viewer=passenger`)).status, 404);
  const arrival = await request(`/trips/${buses[1]}/arrive`, subjects[0], "POST", {
    expectedStopIdentity: "40.7:-74", expectedStartedAt: startedAt.toISOString(),
  });
  assert.equal(arrival.status, 200);
  const [row] = await db.select().from(liveTripsTable).where(eq(liveTripsTable.pairingCode, buses[1]));
  assert.ok(row.completedAt);
  const ended = await (await request(`/trips/public/${buses[1]}`)).json() as Record<string, unknown>;
  assert.equal(ended.locationVisibility, "ended");
  assert.equal(ended.currentLocation, null);
  assert.deepEqual(ended.routeGeometry, []);
  assert.equal((await request(`/trips/${buses[1]}/logout`, subjects[0], "POST")).status, 204);
  const [released] = await db.select().from(liveTripsTable).where(eq(liveTripsTable.pairingCode, buses[1]));
  assert.equal(released.ownerSubject, subjects[0]);
  assert.equal(released.officialRunKey, runKey);
  assert.equal(released.retiredAt, null);
  assert.equal((await request("/trips", subjects[1], "POST", { busNumber: buses[1] })).status, 403);
});

test("client schedule times and coordinates cannot create an unverified official assignment", async () => {
  await db.insert(liveTripsTable).values({
    pairingCode: buses[2],
    ownerSubject: subjects[0],
    status: "ready",
    officialRunKey: `${runKey}-assigned`,
    scheduledDepartureAt: new Date(Date.now() + 3600_000),
  });
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("upstream unavailable"); });
  const response = await request(`/trips/${buses[2]}/route-plan`, subjects[0], "PUT", {
    officialRunKey: runKey, scheduledDepartureAt: "2000-01-01T00:00:00Z",
    destination: { id: "spoof", address: "Spoofed point", lat: 1, lng: 1 }, intermediateStops: [],
  });
  assert.equal(response.status, 403);
  fetchMock.mock.restore();
  const [row] = await db.select().from(liveTripsTable).where(eq(liveTripsTable.pairingCode, buses[2]));
  assert.equal(row.officialRunKey, `${runKey}-assigned`);
  assert.ok(row.scheduledDepartureAt);
  const hidden = await (await request(`/trips/public/${buses[2]}`)).json() as Record<string, unknown>;
  assert.equal(hidden.locationVisibility, "before_departure");
  assert.equal(hidden.currentLocation, null);
});

test("cookie-authenticated driver writes reject cross-origin browsers without breaking public passenger endpoints", async () => {
  const sameOrigin = new URL(baseUrl).origin;
  const crossOrigin = { origin: "https://attacker.example", "sec-fetch-site": "cross-site" };
  const rejected = await request("/driver/profile", subjects[0], "PUT", {
    username: "attack", unitNumber: "wrong", phoneNumber: "8455550123",
  }, crossOrigin);
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json() as { code: string }).code, "UNTRUSTED_ORIGIN");
  assert.equal((await request("/driver/release-coaches", subjects[0], "POST", undefined, crossOrigin)).status, 403);
  assert.equal((await request("/trips", subjects[0], "POST", { busNumber: buses[2] }, crossOrigin)).status, 403);
  assert.equal((await request(`/trips/${buses[2]}/stop`, subjects[0], "POST", undefined, crossOrigin)).status, 403);
  assert.equal((await request("/driver/profile", subjects[0], "GET", undefined, crossOrigin)).status, 403);
  assert.equal((await request("/trips", subjects[0], "POST", { busNumber: buses[2] },
    { origin: sameOrigin, "sec-fetch-site": "same-origin" })).status, 201);
  // No-Origin service requests are permitted only after successful Clerk auth.
  assert.equal((await request("/driver/release-coaches", undefined, "POST")).status, 401);
  assert.equal((await request("/driver/profile", subjects[0])).status, 200);
  // The same headers do not gate public Expo/passenger APIs.
  assert.equal((await request("/passenger/snapshot", undefined, "POST", { passengerCode: "invalid" }, crossOrigin)).status, 404);
});

test("signed-in revoked drivers can disconnect screens without releasing dispatch assignments", async () => {
  const crossOrigin = { origin: "https://attacker.example", "sec-fetch-site": "cross-site" };
  await db.insert(liveTripsTable).values([
    {
      pairingCode: buses[9], ownerSubject: subjects[2], status: "running",
      currentLat: 41.1, currentLng: -74.1, routeGeometry: [{ lat: 41.1, lng: -74.1 }],
    },
    {
      pairingCode: buses[10], ownerSubject: subjects[2], status: "ready",
      currentLat: 41.2, currentLng: -74.2, routeGeometry: [{ lat: 41.2, lng: -74.2 }],
    },
    {
      pairingCode: buses[11], ownerSubject: subjects[1], status: "running",
      currentLat: 41.3, currentLng: -74.3, routeGeometry: [{ lat: 41.3, lng: -74.3 }],
    },
  ]);
  await db.insert(dispatchAssignmentsTable).values([buses[9], buses[10]].map((busNumber, index) => ({
    busNumber,
    driverSubject: subjects[2],
    officialRunKey: `2026-09-22|2|2|3|signout-${index}`,
    serviceDate: "2026-09-22",
    direction: "Monsey → Boro Park",
    scheduledDepartureAt: new Date("2026-09-22T08:00:00.000Z"),
  })));

  assert.equal((await request("/driver/release-coaches", undefined, "POST")).status, 401);
  const untrusted = await request("/driver/release-coaches", subjects[2], "POST", undefined, {
    ...crossOrigin, "x-test-driver-access": "denied",
  });
  assert.equal(untrusted.status, 403);
  assert.equal((await untrusted.json() as { code: string }).code, "UNTRUSTED_ORIGIN");

  const released = await request("/driver/release-coaches", subjects[2], "POST", undefined, {
    "x-test-driver-access": "denied",
  });
  assert.equal(released.status, 204);
  assert.equal((await request("/driver/release-coaches", subjects[2], "POST", undefined, {
    "x-test-driver-access": "denied",
  })).status, 204);

  const rows = await db.select().from(liveTripsTable)
    .where(inArray(liveTripsTable.pairingCode, [buses[9], buses[10], buses[11]]));
  const ownRows = rows.filter(row => [buses[9], buses[10]].includes(row.pairingCode));
  assert.equal(ownRows.length, 2);
  for (const row of ownRows) {
    assert.equal(row.ownerSubject, subjects[2]);
    assert.equal(row.retiredAt, null);
    assert.equal(row.completedAt, null);
    assert.match(row.passengerPairingCode ?? "", /^\d{4}$/);
  }
  assert.equal(ownRows.find(row => row.pairingCode === buses[9])?.status, "running");
  assert.equal(ownRows.find(row => row.pairingCode === buses[9])?.currentLat, 41.1);
  assert.equal(ownRows.find(row => row.pairingCode === buses[10])?.status, "ready");
  assert.equal(ownRows.find(row => row.pairingCode === buses[10])?.currentLat, 41.2);
  const other = rows.find(row => row.pairingCode === buses[11]);
  assert.equal(other?.ownerSubject, subjects[1]);
  assert.equal(other?.status, "running");
  assert.equal(other?.currentLat, 41.3);
  assert.equal(other?.currentLng, -74.3);
  assert.deepEqual(other?.routeGeometry, [{ lat: 41.3, lng: -74.3 }]);
  const history = await db.select().from(dispatchAssignmentsTable)
    .where(inArray(dispatchAssignmentsTable.busNumber, [buses[9], buses[10]]));
  assert.equal(history.length, 2);
  assert.equal(history.filter(row => row.outcome === "active").length, 2);
  assert.equal(history.filter(row => row.endedAt === null).length, 2);
});

test("concurrent official assignments allow only one active coach; completed rows cannot mask it", async () => {
  const key = `2026-07-01|1|2|5|race-${randomBytes(4).toString("hex")}`;
  await db.insert(liveTripsTable).values([0, 1].map(i => ({
    pairingCode: buses[i + 3],
    ownerSubject: subjects[i],
  })));
  await db.insert(liveTripsTable).values({
    pairingCode: buses[5], ownerSubject: subjects[0], officialRunKey: key,
    status: "stopped", completedAt: new Date(), scheduledDepartureAt: new Date(Date.now() - 7200_000),
    updatedAt: new Date(Date.now() + 3600_000),
  });
  const attempts = await Promise.allSettled([0, 1].map(async i => {
    const [row] = await db.select().from(liveTripsTable).where(eq(liveTripsTable.pairingCode, buses[i + 3]));
    return assignOfficialRun(row.pairingCode, subjects[i], row.updatedAt, {
      officialRunKey: key, scheduledDepartureAt: new Date(Date.now() + 3600_000), status: "ready",
      completedAt: null,
    });
  }));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  const rejected = attempts.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.status, 409);
  const winner = attempts.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof assignOfficialRun>>>;
  for (const path of ["/trips/public-run/", "/passenger/public-run/"]) {
    const body = await (await request(`${path}${encodeURIComponent(key)}`)).json() as Record<string, any>;
    assert.equal(body.busNumber ?? body.coachNumber, winner.value.pairingCode);
    assert.equal(body.trip.locationVisibility, "before_departure");
  }

  for (const path of ["/trips/public-run/", "/passenger/public-run/"]) {
    const response = await request(
      `${path}${encodeURIComponent("2026-09-22|1|3|2|225~21:30:00")}`,
    );
    assert.notEqual(response.status, 400);
  }
  await db.update(liveTripsTable).set({ completedAt: new Date(), status: "stopped" })
    .where(eq(liveTripsTable.pairingCode, winner.value.pairingCode));
  for (const path of ["/trips/public-run/", "/passenger/public-run/"]) {
    const body = await (await request(`${path}${encodeURIComponent(key)}`)).json() as Record<string, any>;
    assert.equal(body.trip.locationVisibility, "ended");
  }
});

test("existing retired-coach cleanup preserves the 30-day retention boundary", async () => {
  await db.insert(liveTripsTable).values([
    { pairingCode: buses[6], retiredAt: new Date(Date.now() - 31 * 86400_000) },
    { pairingCode: buses[7], retiredAt: new Date(Date.now() - 29 * 86400_000) },
  ]);
  assert.equal((await request("/trips", subjects[0], "POST", { busNumber: buses[8] })).status, 403);
  const rows = await db.select({ code: liveTripsTable.pairingCode }).from(liveTripsTable)
    .where(inArray(liveTripsTable.pairingCode, [buses[6], buses[7]]));
  assert.deepEqual(rows.map(row => row.code), [buses[7]]);
});
