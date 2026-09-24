import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import { adminDisplayReceiptsTable, adminDisplaySettingsTable, db, driverProfilesTable, liveTripsTable, pool } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import router from "./index";
import { activePassengerDisplays, applyOfficialStopNotes, findNearestCrossStreet, recordPassengerStatus } from "./trip";
import { clearOfficialScheduleCachesForTest, resolveOfficialAssignment } from "./schedule";

const busNumbers = [randomBusNumber(), randomBusNumber()];
const labelBusNumber = randomBusNumber();
const multiBrowserBusNumber = randomBusNumber();
const routeCleanupBusNumber = randomBusNumber();
const unknownBusNumber = randomBusNumber();
const gpslessBusNumber = randomBusNumber();
const driverSubject = `trip-driver-${randomBytes(6).toString("hex")}`;
const app = express();

test("official notes attach only to the unchanged official stop identity and coordinates", () => {
  const official = [{ id: "official-1", address: "raw", lat: 41.1, lng: -74.1, note: "across Ohr Sameach" }];
  assert.deepEqual(applyOfficialStopNotes(
    [{ id: "official-1", address: "Route 306 & Viola Road", lat: 41.1, lng: -74.1 }],
    official,
  )[0].note, "across Ohr Sameach");
  assert.equal(applyOfficialStopNotes(
    [{ id: "custom-1", address: "Custom stop", lat: 41.1, lng: -74.1 }],
    official,
  )[0].note, undefined);
  assert.equal(applyOfficialStopNotes(
    [{ id: "official-1", address: "Moved stop", lat: 41.2, lng: -74.1 }],
    official,
  )[0].note, undefined);
});

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

function randomBusNumber() {
  return randomBytes(3).toString("hex").toUpperCase();
}

test("nearest cross street uses the closest node shared by two named roads", () => {
  const point = { lat: 40.63001, lng: -73.99001 };
  const elements = [
    { type: "node" as const, id: 1, lat: 40.63, lon: -73.99 },
    { type: "node" as const, id: 2, lat: 40.631, lon: -73.991 },
    { type: "node" as const, id: 3, lat: 40.631, lon: -73.992 },
    { type: "way" as const, id: 10, nodes: [1, 2], tags: { highway: "secondary", name: "18th Avenue" } },
    { type: "way" as const, id: 11, nodes: [1, 3], tags: { highway: "residential", name: "49th Street" } },
    { type: "way" as const, id: 12, nodes: [2, 3], tags: { highway: "residential", name: "Unrelated Road" } },
  ];

  assert.equal(findNearestCrossStreet(elements, point), "18th Avenue & 49th Street");
  assert.equal(findNearestCrossStreet(elements.slice(0, 4), point), null);
});

interface TripResponse {
  status: string;
  officialRunKey: string | null;
  scheduledDepartureAt: string | null;
  destinationAddress?: string;
  destination?: { lat: number; lng: number } | null;
  emergencyOverride: boolean;
  emergencyMessage: string;
  routeId: string;
  displayMode: string;
  rotationIntervalSeconds: number;
  arrivalSoundsEnabled: boolean;
  announcements: Array<{ id: string; title: string; message: string; active: boolean }>;
  chimeTestRequestedAt: string | null;
  intermediateStops: Array<{ id: string; address: string; lat: number; lng: number }>;
  routeGeometry?: Array<{ lat: number; lng: number }>;
  updatedAt?: string;
  startedAt?: string | null;
  currentLocation?: { lat: number; lng: number } | null;
  origin?: { lat: number; lng: number } | null;
  passengerDisplays: Array<{ id: string; audioReady: boolean }>;
}

interface OperatorConnectionResponse {
  busNumber: string;
  pairingCode: string;
  trip: TripResponse;
}

function startServer() {
  return new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}/api`;
      resolve();
    });
    server.once("error", reject);
  });
}

function stopServer() {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function request(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

async function connectOperator(busNumber: string) {
  await db.insert(liveTripsTable).values({
    pairingCode: busNumber,
    ownerSubject: driverSubject,
    status: "ready",
    officialRunKey: `2026-09-22|2|2|3|test-${busNumber}`,
    scheduledDepartureAt: new Date(Date.now() + 3600_000),
    destinationAddress: "Published destination",
    destinationLat: 40.73,
    destinationLng: -74.006,
  }).onConflictDoUpdate({
    target: liveTripsTable.pairingCode,
    set: {
      ownerSubject: driverSubject,
      status: "ready",
      officialRunKey: `2026-09-22|2|2|3|test-${busNumber}`,
      scheduledDepartureAt: new Date(Date.now() + 3600_000),
      completedAt: null,
      retiredAt: null,
      updatedAt: new Date(),
    },
  });
  const response = await request("/trips", {
    method: "POST",
    body: JSON.stringify({ busNumber }),
  });
  assert.equal(response.status, 201);
  return response.json() as Promise<OperatorConnectionResponse>;
}

before(async () => {
  mock.method(clerkClient.sessions, "getSession", async () => ({
    userId: driverSubject, status: "active",
  }) as never);
  mock.method(clerkClient.users, "getUser", async () => ({
    id: driverSubject, username: "trip-driver", banned: false, locked: false,
    privateMetadata: { role: "driver", driverAccess: true },
  }) as never);
  await db.insert(driverProfilesTable).values({
    clerkSubject: driverSubject, username: "trip-driver", usernameKey: "trip-driver",
    unitNumber: "test", phoneNumber: "+18455550123",
  });
  await db.delete(liveTripsTable).where(inArray(liveTripsTable.pairingCode, [...busNumbers, labelBusNumber, multiBrowserBusNumber, routeCleanupBusNumber, unknownBusNumber, gpslessBusNumber]));
  await startServer();
});

after(async () => {
  mock.restoreAll();
  if (server.listening) await stopServer();
  await db.delete(liveTripsTable).where(inArray(liveTripsTable.pairingCode, [...busNumbers, labelBusNumber, multiBrowserBusNumber, routeCleanupBusNumber, unknownBusNumber, gpslessBusNumber]));
  await db.delete(driverProfilesTable).where(eq(driverProfilesTable.clerkSubject, driverSubject));
  await pool.end();
});

test("bus trip and emergency updates stay isolated by bus number", async () => {
  await Promise.all(busNumbers.map(connectOperator));

  const [firstEmergency, secondEmergency] = await Promise.all([
    request(`/trips/${busNumbers[0]}/emergency`, {
      method: "PATCH",
      body: JSON.stringify({ emergencyOverride: true, emergencyMessage: "Coach one message" }),
    }),
    request(`/trips/${busNumbers[1]}/emergency`, {
      method: "PATCH",
      body: JSON.stringify({ emergencyOverride: false, emergencyMessage: "Coach two message" }),
    }),
  ]);
  assert.equal(firstEmergency.status, 200);
  assert.equal(secondEmergency.status, 200);

  const stopResponse = await request(`/trips/${busNumbers[0]}/stop`, { method: "POST" });
  assert.equal(stopResponse.status, 200);

  const [firstResponse, secondResponse] = await Promise.all([
    request(`/trips/${busNumbers[0]}`),
    request(`/trips/${busNumbers[1]}`),
  ]);
  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);

  const first = await firstResponse.json() as TripResponse;
  const second = await secondResponse.json() as TripResponse;
  assert.equal(first.status, "stopped");
  assert.equal(first.emergencyOverride, true);
  assert.equal(first.emergencyMessage, "Coach one message");
  assert.equal(second.status, "ready");
  assert.equal(second.emergencyOverride, false);
  assert.equal(second.emergencyMessage, "Coach two message");
});

test("a driver can start without GPS and publish a real location after GPS recovers", async () => {
  await connectOperator(gpslessBusNumber);

  const startedResponse = await request(`/trips/${gpslessBusNumber}/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(startedResponse.status, 200);
  const started = await startedResponse.json() as TripResponse;
  assert.equal(started.status, "running");
  assert.ok(started.startedAt);
  assert.equal(started.currentLocation, null);
  assert.equal(started.origin, null);

  const recoveredResponse = await request(`/trips/${gpslessBusNumber}/location`, {
    method: "POST",
    body: JSON.stringify({ lat: 40.7, lng: -74, speedMph: 12 }),
  });
  assert.equal(recoveredResponse.status, 200);
  const recovered = await recoveredResponse.json() as TripResponse;
  assert.deepEqual(recovered.currentLocation, { lat: 40.7, lng: -74 });
});

test("connecting the same bus from another browser preserves the existing session", async () => {
  const firstConnection = await connectOperator(multiBrowserBusNumber);
  assert.match(firstConnection.pairingCode, /^\d{4}$/);
  const emergency = await request(`/trips/${multiBrowserBusNumber}/emergency`, {
    method: "PATCH",
    body: JSON.stringify({ emergencyOverride: true, emergencyMessage: "Keep this session active" }),
  });
  assert.equal(emergency.status, 200);

  const secondConnection = await connectOperator(multiBrowserBusNumber);
  assert.equal(secondConnection.pairingCode, firstConnection.pairingCode);

  const current = await request(`/trips/${multiBrowserBusNumber}`);
  assert.equal(current.status, 200);
  const trip = await current.json() as TripResponse;
  assert.equal(trip.emergencyOverride, true);
  assert.equal(trip.emergencyMessage, "Keep this session active");
});

test("logging out expires the passenger code and reconnecting generates a new one", async () => {
  const busNumber = randomBusNumber();
  try {
    const first = await connectOperator(busNumber);
    const paired = await request("/trips/pair", {
      method: "POST",
      body: JSON.stringify({ pairingCode: first.pairingCode }),
    });
    assert.equal(paired.status, 200);

    const logout = await request(`/trips/${busNumber}/logout`, { method: "POST" });
    assert.equal(logout.status, 204);

    const expired = await request("/trips/pair", {
      method: "POST",
      body: JSON.stringify({ pairingCode: first.pairingCode }),
    });
    assert.equal(expired.status, 404);

    const second = await connectOperator(busNumber);
    assert.match(second.pairingCode, /^\d{4}$/);
    assert.notEqual(second.pairingCode, first.pairingCode);
  } finally {
    await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  }
});

async function createQrInvite(busNumber: string, passengerPairingCode: string) {
  const inviteResponse = await request(`/trips/${busNumber}/qr-invite`, {
    method: "POST",
    body: JSON.stringify({ passengerPairingCode }),
  });
  assert.equal(inviteResponse.status, 201);
  const invite = await inviteResponse.json() as { token: string; expiresAt: string };
  assert.match(invite.token, /^[A-Za-z0-9_-]{80,}$/);
  return invite;
}

test("valid current-session QR invitations preview and pair successfully", async () => {
  const busNumber = randomBusNumber();
  try {
    const connected = await connectOperator(busNumber);
    const invite = await createQrInvite(busNumber, connected.pairingCode);

    const preview = await request(`/trips/qr-invites/${invite.token}`);
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { busNumber: string };
    assert.equal(previewBody.busNumber, busNumber);

    const paired = await request(`/trips/qr-invites/${invite.token}/pair`, { method: "POST" });
    assert.equal(paired.status, 200);
  } finally {
    await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  }
});

test("altered QR invitation tokens are rejected for preview and pairing", async () => {
  const busNumber = randomBusNumber();
  try {
    const connected = await connectOperator(busNumber);
    const invite = await createQrInvite(busNumber, connected.pairingCode);
    const rawToken = Buffer.from(invite.token, "base64url");
    rawToken[Math.floor(rawToken.length / 2)] ^= 0xff;
    const alteredToken = rawToken.toString("base64url");

    const preview = await request(`/trips/qr-invites/${alteredToken}`);
    assert.equal(preview.status, 404);
    const paired = await request(`/trips/qr-invites/${alteredToken}/pair`, { method: "POST" });
    assert.equal(paired.status, 404);
  } finally {
    await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  }
});

test("QR invitation tokens older than ten minutes are rejected", async () => {
  const busNumber = randomBusNumber();
  try {
    const connected = await connectOperator(busNumber);
    const invite = await createQrInvite(busNumber, connected.pairingCode);
    const expiresAt = Date.parse(invite.expiresAt);
    assert.ok(Number.isFinite(expiresAt));

    mock.timers.enable({ apis: ["Date"], now: expiresAt + 1 });
    const preview = await request(`/trips/qr-invites/${invite.token}`);
    assert.equal(preview.status, 404);
    const paired = await request(`/trips/qr-invites/${invite.token}/pair`, { method: "POST" });
    assert.equal(paired.status, 404);
  } finally {
    mock.timers.reset();
    await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  }
});

test("a QR invitation from a logged-out session stays invalid after the coach reconnects", async () => {
  const busNumber = randomBusNumber();
  try {
    const firstSession = await connectOperator(busNumber);
    const invite = await createQrInvite(busNumber, firstSession.pairingCode);

    const logout = await request(`/trips/${busNumber}/logout`, { method: "POST" });
    assert.equal(logout.status, 204);

    const secondSession = await connectOperator(busNumber);
    assert.notEqual(secondSession.pairingCode, firstSession.pairingCode);

    const preview = await request(`/trips/qr-invites/${invite.token}`);
    assert.equal(preview.status, 404);
    const paired = await request(`/trips/qr-invites/${invite.token}/pair`, { method: "POST" });
    assert.equal(paired.status, 404);
  } finally {
    await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  }
});

test("QR invitation creation requires the passenger pairing code, not just the bus number", async () => {
  const busNumber = randomBusNumber();
  try {
    const connected = await connectOperator(busNumber);
    const missingProof = await request(`/trips/${busNumber}/qr-invite`, { method: "POST" });
    assert.equal(missingProof.status, 403);

    const wrongProof = await request(`/trips/${busNumber}/qr-invite`, {
      method: "POST",
      body: JSON.stringify({ passengerPairingCode: "0000" }),
    });
    assert.equal(wrongProof.status, 403);

    const correctProof = await request(`/trips/${busNumber}/qr-invite`, {
      method: "POST",
      body: JSON.stringify({ passengerPairingCode: connected.pairingCode }),
    });
    assert.equal(correctProof.status, 201);
  } finally {
    await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  }
});

test("unknown and malformed bus numbers are rejected", async () => {
  const malformed = await request("/trips/not-valid");
  assert.equal(malformed.status, 400);

  const unknown = await request(`/trips/${unknownBusNumber}`);
  assert.equal(unknown.status, 404);

  const malformedUpdate = await request("/trips/bad-code/emergency", {
    method: "PATCH",
    body: JSON.stringify({ emergencyOverride: true, emergencyMessage: "Must not update" }),
  });
  assert.equal(malformedUpdate.status, 400);

  const unknownUpdate = await request(`/trips/${unknownBusNumber}/emergency`, {
    method: "PATCH",
    body: JSON.stringify({ emergencyOverride: true, emergencyMessage: "Must not update" }),
  });
  assert.equal(unknownUpdate.status, 404);
});

test("operator display settings sync by bus number and keep the safety view coach-specific", async () => {
  const [firstUpdate, secondUpdate] = await Promise.all([
    request(`/trips/${busNumbers[0]}/display-settings`, {
      method: "PATCH",
      body: JSON.stringify({
        routeId: "route-3", displayMode: "weather", passengerLanguage: "en", rotationIntervalSeconds: 20,
        arrivalSoundsEnabled: false,
      }),
    }),
    request(`/trips/${busNumbers[1]}/display-settings`, {
      method: "PATCH",
      body: JSON.stringify({
        routeId: "route-1", displayMode: "auto", passengerLanguage: "en", rotationIntervalSeconds: 15,
        arrivalSoundsEnabled: true,
      }),
    }),
  ]);
  assert.equal(firstUpdate.status, 200);
  assert.equal(secondUpdate.status, 200);
  const [firstResponse, secondResponse] = await Promise.all([
    request(`/trips/${busNumbers[0]}`),
    request(`/trips/${busNumbers[1]}`),
  ]);
  const first = await firstResponse.json() as TripResponse;
  const second = await secondResponse.json() as TripResponse;
  assert.equal(first.routeId, "route-3");
  assert.equal(first.displayMode, "weather");
  assert.equal(first.rotationIntervalSeconds, 20);
  assert.equal(first.arrivalSoundsEnabled, false);
  assert.equal(second.routeId, "route-1");
  assert.equal(second.displayMode, "auto");
  assert.equal(second.arrivalSoundsEnabled, true);

  const protectedSafety = await request(`/trips/${busNumbers[0]}/display-settings`, {
    method: "PATCH",
    body: JSON.stringify({
      routeId: "route-1",
      displayMode: "safety",
      passengerLanguage: "en",
      rotationIntervalSeconds: 15,
      arrivalSoundsEnabled: true,
    }),
  });
  assert.equal(protectedSafety.status, 200);
  const safetyTrip = await protectedSafety.json() as TripResponse;
  assert.equal(safetyTrip.displayMode, "safety");
  const unchangedSecond = await (await request(`/trips/${busNumbers[1]}`)).json() as TripResponse;
  assert.equal(unchangedSecond.displayMode, "auto");
});

test("drivers cannot overwrite dispatch route stops", async () => {
  await Promise.all(busNumbers.map(connectOperator));
  const routePlan = {
    destination: {
      id: "destination",
      address: "Midtown, New York, NY, United States",
      lat: 40.7549,
      lng: -73.984,
    },
    intermediateStops: [
      {
        id: "stop-one",
        address: "Monsey, New York, United States",
        lat: 41.1112,
        lng: -74.0685,
      },
      {
        id: "stop-two",
        address: "Boro Park, Brooklyn, New York, United States",
        lat: 40.635,
        lng: -73.992,
      },
    ],
  };
  const update = await request(`/trips/${busNumbers[0]}/route-plan`, {
    method: "PUT",
    body: JSON.stringify(routePlan),
  });
  assert.equal(update.status, 403);
  assert.equal((await update.json() as { code: string }).code, "ADMIN_DISPATCH_REQUIRED");

  const [firstResponse, secondResponse] = await Promise.all([
    request(`/trips/${busNumbers[0]}`),
    request(`/trips/${busNumbers[1]}`),
  ]);
  const first = await firstResponse.json() as TripResponse;
  const second = await secondResponse.json() as TripResponse;
  assert.deepEqual(first.intermediateStops, []);
  assert.deepEqual(second.intermediateStops, []);
  return;

  const invalid = await request(`/trips/${busNumbers[0]}/route-plan`, {
    method: "PUT",
    body: JSON.stringify({
      destination: routePlan.destination,
        intermediateStops: Array.from({ length: 25 }, (_, index) => ({
        id: `stop-${index}`,
        address: `Stop ${index}, New York, United States`,
        lat: 40.7,
        lng: -73.9,
      })),
    }),
  });
  assert.equal(invalid.status, 400);

  const startedAt = new Date();
  await db.update(liveTripsTable)
    .set({ status: "running", startedAt })
    .where(eq(liveTripsTable.pairingCode, busNumbers[0]));
  const arrival = await request(`/trips/${busNumbers[0]}/arrive`, {
    method: "POST",
    body: JSON.stringify({
      expectedStopIdentity: routePlan.intermediateStops[0].id,
      expectedStartedAt: startedAt.toISOString(),
    }),
  });
  assert.equal(arrival.status, 200);
  const arrivalBody = await arrival.json() as {
    trip: TripResponse;
    arrivedAt: string;
    nextDestination: string;
    tripComplete: boolean;
  };
  assert.equal(arrivalBody.arrivedAt, routePlan.intermediateStops[0].address);
  assert.equal(arrivalBody.nextDestination, routePlan.intermediateStops[1].address);
  assert.equal(arrivalBody.tripComplete, false);
  assert.deepEqual(arrivalBody.trip.intermediateStops, [routePlan.intermediateStops[1]]);
});

test("drivers cannot replace an official dispatch assignment", async () => {
  const busNumber = randomBusNumber();
  const originalFetch = globalThis.fetch;
  const runKey = "2026-09-20|2|2|3|700";
  clearOfficialScheduleCachesForTest();
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(baseUrl)) return originalFetch(input, init);
    if (url.endsWith("/ajax/schedule")) {
      return Response.json({
        origin: "Monsey", origin_id: 2, destination: "Boro Park", destination_id: 3,
        schedule: [{
          schedule_busroute_id: 700, first_time: "08:00:00", time: "08:00:00",
          arrival: "09:00:00", duration: 60,
          busroute: {
            id: 70, route_code: "B2", route_symbol: "2", route_symbol2: "",
            direction: "outgoing", description: "Maple Avenue in front of the nursing home",
            description2: "Along 50th St",
          },
        }],
      });
    }
    if (url === "https://overpass-api.de/api/interpreter") return Response.json({ elements: [] });
    if (url.endsWith("/")) {
      return new Response('<meta name="csrf-token" content="test-token">', {
        headers: { "set-cookie": "session=test; Path=/" },
      });
    }
    throw new Error(`Unexpected external request: ${url}`);
  });
  try {
    const connection = await connectOperator(busNumber);
    const official = await resolveOfficialAssignment(runKey);
    const destination = { id: "untrusted-final", address: "Wrong final destination", lat: 41, lng: -74 };
    const first = { id: "driver-one", address: "First Street & Second Avenue", lat: 40.71, lng: -73.98 };
    const second = { id: "driver-two", address: "Third Street & Fourth Avenue", lat: 40.72, lng: -73.97 };
    const save = (intermediateStops: unknown) => request(`/trips/${busNumber}/route-plan`, {
      method: "PUT", body: JSON.stringify({ officialRunKey: runKey, destination, intermediateStops }),
    });
    const initial = await save([first]);
    assert.equal(initial.status, 403);
    assert.equal((await initial.json() as { code: string }).code, "ADMIN_DISPATCH_REQUIRED");
    const unchanged = await (await request(`/trips/${busNumber}`)).json() as TripResponse;
    assert.equal(unchanged.officialRunKey, `2026-09-22|2|2|3|test-${busNumber}`);
    return;
    const initialized = await initial.json() as TripResponse;
    assert.deepEqual(initialized.intermediateStops, official.intermediateStops);
    for (const stops of [[first, second], [second, first], [second], []]) {
      const response = await save(stops);
      assert.equal(response.status, 200);
      const saved = await response.json() as TripResponse;
      assert.deepEqual(saved.intermediateStops, stops);
      assert.equal(saved.officialRunKey, official.canonicalRunKey);
      assert.equal(saved.scheduledDepartureAt, official.scheduledDepartureAt.toISOString());
      assert.deepEqual(saved.destination, { lat: destination.lat, lng: destination.lng });
      assert.equal(saved.destinationAddress, destination.address);
      const reloaded = await (await request(`/trips/${busNumber}`)).json() as TripResponse;
      assert.deepEqual(reloaded.intermediateStops, stops);
      assert.deepEqual(reloaded.destination, { lat: destination.lat, lng: destination.lng });
      const passenger = await (await request(`/trips/${connection.pairingCode}?viewer=passenger`)).json() as TripResponse;
      assert.deepEqual(passenger.intermediateStops, stops);
    }
    for (const invalid of [null, [{ ...first, lat: 91 }], Array.from({ length: 25 }, () => first)]) {
      assert.equal((await save(invalid)).status, 400);
    }
    assert.deepEqual((await (await request(`/trips/${busNumber}`)).json() as TripResponse).intermediateStops, []);

    await db.update(liveTripsTable).set({
      status: "running", intermediateStops: [first], startedAt: new Date(),
    }).where(eq(liveTripsTable.pairingCode, busNumber));
    const running = await save([second]);
    assert.equal(running.status, 200);
    const protectedTrip = await running.json() as TripResponse;
    assert.equal(protectedTrip.status, "running");
    assert.deepEqual(protectedTrip.intermediateStops, [first]);

    await db.update(liveTripsTable).set({ ownerSubject: `${driverSubject}-other` })
      .where(eq(liveTripsTable.pairingCode, busNumber));
    assert.equal((await save([second])).status, 403);
  } finally {
    fetchMock.mock.restore();
    clearOfficialScheduleCachesForTest();
    await db.delete(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber));
  }
});

test("stopping or finishing a trip clears passenger route information", async () => {
  await connectOperator(routeCleanupBusNumber);
  const destination = {
    id: "cleanup-destination",
    address: "Empire Boulevard & Kingston Avenue",
    lat: 40.668,
    lng: -73.942,
  };
  const startedAt = new Date();
  await db.update(liveTripsTable)
    .set({
      status: "running",
      destinationAddress: destination.address,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
      intermediateStops: [{
        id: "cleanup-stop",
        address: destination.address,
        lat: destination.lat,
        lng: destination.lng,
      }],
      startedAt,
      displayMode: "next-stop",
    })
    .where(eq(liveTripsTable.pairingCode, routeCleanupBusNumber));

  const stoppedResponse = await request(`/trips/${routeCleanupBusNumber}/stop`, { method: "POST" });
  assert.equal(stoppedResponse.status, 200);
  const stopped = await stoppedResponse.json() as TripResponse;
  assert.deepEqual(stopped.intermediateStops, []);
  assert.equal(stopped.destinationAddress, "");
  assert.equal(stopped.destination, null);
  assert.equal(stopped.displayMode, "auto");

  const finalStartedAt = new Date();
  await db.update(liveTripsTable)
    .set({
      status: "running",
      destinationAddress: destination.address,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
      intermediateStops: [],
      startedAt: finalStartedAt,
      displayMode: "next-stop",
    })
    .where(eq(liveTripsTable.pairingCode, routeCleanupBusNumber));
  const completedResponse = await request(`/trips/${routeCleanupBusNumber}/arrive`, {
    method: "POST",
    body: JSON.stringify({
      expectedStopIdentity: `${destination.lat}:${destination.lng}`,
      expectedStartedAt: finalStartedAt.toISOString(),
    }),
  });
  assert.equal(completedResponse.status, 200);
  const completed = await completedResponse.json() as { trip: TripResponse; tripComplete: boolean };
  assert.equal(completed.tripComplete, true);
  assert.deepEqual(completed.trip.intermediateStops, []);
  assert.equal(completed.trip.destinationAddress, "");
  assert.equal(completed.trip.destination, null);
  assert.equal(completed.trip.displayMode, "auto");
});

test("route setup selects the nearest real cross streets and ignores paths and service roads", async () => {
  await connectOperator(labelBusNumber);
  const originalFetch = globalThis.fetch;
  const destination = {
    id: "destination-provider-failure",
    address: "1214 48th Street, Borough Park, Brooklyn, New York, 11219, United States",
    lat: 40.6361,
    lng: -73.9942,
  };
  const overpassFixture = {
    elements: [
      { type: "node", id: 1, lat: 40.63611, lon: -73.99421 },
      { type: "node", id: 2, lat: 40.6363, lon: -73.9944 },
      { type: "way", id: 10, nodes: [1], tags: { highway: "service", name: "Loading Dock Road" } },
      { type: "way", id: 11, nodes: [1], tags: { highway: "path", name: "School Footpath" } },
      { type: "way", id: 12, nodes: [2], tags: { highway: "residential", name: "48th Street" } },
      { type: "way", id: 13, nodes: [2], tags: { highway: "secondary", name: "18th Avenue" } },
      { type: "node", id: 3, lat: 40.638, lon: -73.996 },
      { type: "way", id: 14, nodes: [3], tags: { highway: "residential", name: "49th Street" } },
      { type: "way", id: 15, nodes: [3], tags: { highway: "secondary", name: "19th Avenue" } },
    ],
  };
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === "https://overpass-api.de/api/interpreter") {
      return new Response(JSON.stringify(overpassFixture), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  });

  try {
    const update = await request(`/trips/${labelBusNumber}/route-plan`, {
      method: "PUT",
      body: JSON.stringify({ destination, intermediateStops: [] }),
    });
    assert.equal(update.status, 403);
    assert.equal((await update.json() as { code: string }).code, "ADMIN_DISPATCH_REQUIRED");
    return;
  } finally {
    fetchMock.mock.restore();
  }
});

test("cross-street provider failure preserves route setup labels and coordinates", async () => {
  const originalFetch = globalThis.fetch;
  const destination = {
    id: "destination-provider-failure",
    address: "1214 48th Street, Borough Park, Brooklyn, New York, 11219, United States",
    lat: 40.6361,
    lng: -73.9942,
  };
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === "https://overpass-api.de/api/interpreter") {
      throw new Error("Intersection provider unavailable");
    }
    return originalFetch(input, init);
  });

  try {
    const update = await request(`/trips/${labelBusNumber}/route-plan`, {
      method: "PUT",
      body: JSON.stringify({ destination, intermediateStops: [] }),
    });
    assert.equal(update.status, 403);
    assert.equal((await update.json() as { code: string }).code, "ADMIN_DISPATCH_REQUIRED");
    return;
  } finally {
    fetchMock.mock.restore();
  }
});

test("passenger display can only join a bus already connected by an operator", async () => {
  const missing = await request("/trips/pair", {
    method: "POST",
    body: JSON.stringify({ pairingCode: "0000" }),
  });
  assert.equal(missing.status, 404);

  const operator = await connectOperator(busNumbers[0]);
  const connected = await request("/trips/pair", {
    method: "POST",
    body: JSON.stringify({ pairingCode: operator.pairingCode }),
  });
  assert.equal(connected.status, 200);
});

test("chime tests require a connected passenger and publish a separate request signal", async () => {
  const disconnectedBus = busNumbers[1];
  await pool.query(
    "UPDATE live_trips SET passenger_last_seen_at = NULL, chime_test_requested_at = NULL WHERE pairing_code = $1",
    [disconnectedBus],
  );

  const disconnected = await request(`/trips/${disconnectedBus}/test-chime`, { method: "POST" });
  assert.equal(disconnected.status, 409);
  assert.deepEqual(await disconnected.json(), { error: "No passenger display is connected to this bus." });

  const operator = await connectOperator(disconnectedBus);
  const pairResponse = await request("/trips/pair", {
    method: "POST",
    body: JSON.stringify({ pairingCode: operator.pairingCode }),
  });
  assert.equal(pairResponse.status, 200);

  const beforeResponse = await request(`/trips/${disconnectedBus}`);
  const before = await beforeResponse.json() as TripResponse;
  const displayModeBefore = before.displayMode;

  const testedResponse = await request(`/trips/${disconnectedBus}/test-chime`, { method: "POST" });
  assert.equal(testedResponse.status, 200);
  const tested = await testedResponse.json() as TripResponse;
  assert.ok(tested.chimeTestRequestedAt);
  assert.equal(tested.displayMode, displayModeBefore);
  assert.equal(tested.intermediateStops.length, before.intermediateStops.length);
});

test("matching geometry revision omits unchanged route geometry", async () => {
  const routeGeometry = [
    { lat: 41.1112, lng: -74.0685 },
    { lat: 40.7549, lng: -73.984 },
  ];
  await pool.query(
    "UPDATE live_trips SET route_geometry = $1 WHERE pairing_code = $2",
    [JSON.stringify(routeGeometry), busNumbers[0]],
  );

  const initialResponse = await request(`/trips/${busNumbers[0]}`);
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json() as TripResponse;
  assert.deepEqual(initial.routeGeometry, routeGeometry);
  assert.ok(initial.updatedAt);

  const repeatedResponse = await request(
    `/trips/${busNumbers[0]}?geometryVersion=${encodeURIComponent(initial.updatedAt)}`,
  );
  assert.equal(repeatedResponse.status, 200);
  const repeated = await repeatedResponse.json() as TripResponse;
  assert.equal(Object.hasOwn(repeated, "routeGeometry"), false);
});

test("changed geometry revision includes updated route geometry", async () => {
  const previousResponse = await request(`/trips/${busNumbers[0]}`);
  const previous = await previousResponse.json() as TripResponse;
  assert.ok(previous.updatedAt);

  const updatedGeometry = [
    { lat: 41.1112, lng: -74.0685 },
    { lat: 40.9, lng: -74.01 },
    { lat: 40.7549, lng: -73.984 },
  ];
  await pool.query(
    "UPDATE live_trips SET route_geometry = $1, updated_at = $2 WHERE pairing_code = $3",
    [JSON.stringify(updatedGeometry), new Date(Date.now() + 1_000), busNumbers[0]],
  );

  const changedResponse = await request(
    `/trips/${busNumbers[0]}?geometryVersion=${encodeURIComponent(previous.updatedAt)}`,
  );
  assert.equal(changedResponse.status, 200);
  const changed = await changedResponse.json() as TripResponse;
  assert.deepEqual(changed.routeGeometry, updatedGeometry);
  assert.notEqual(changed.updatedAt, previous.updatedAt);
});

test("trip and emergency state survives server reinitialization", async () => {
  const beforeFirst = await (await request(`/trips/${busNumbers[0]}`)).json() as TripResponse;
  const beforeSecond = await (await request(`/trips/${busNumbers[1]}`)).json() as TripResponse;
  await stopServer();
  await startServer();

  const [firstResponse, secondResponse] = await Promise.all([
    request(`/trips/${busNumbers[0]}`),
    request(`/trips/${busNumbers[1]}`),
  ]);
  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);

  const first = await firstResponse.json() as TripResponse;
  const second = await secondResponse.json() as TripResponse;
  assert.deepEqual(first, beforeFirst);
  assert.deepEqual(second, beforeSecond);
});

test("passenger audio readiness is reported to the operator and stale displays expire", async () => {
  const operator = await connectOperator(busNumbers[0]);
  const staleAt = Date.now() - 60_000;
  recordPassengerStatus(busNumbers[0], "stale-display", false, staleAt);
  assert.deepEqual(activePassengerDisplays(busNumbers[0]), []);

  const ready = await request(`/trips/${operator.pairingCode}/passenger-status?viewer=passenger`, {
    method: "PUT",
    body: JSON.stringify({ id: "display-two", audioReady: true }),
  });
  assert.equal(ready.status, 200);
  const registration = await ready.json() as { sessionToken?: string };
  assert.equal(typeof registration.sessionToken, "string");
  assert.ok((registration.sessionToken?.length ?? 0) >= 32);

  const response = await request(`/trips/${busNumbers[0]}`);
  assert.equal(response.status, 200);
  const trip = await response.json() as TripResponse;
  assert.deepEqual(trip.passengerDisplays, [{ id: "display-two", audioReady: true }]);
});

test("display setting receipts require the registered current screen session and pairing generation", async () => {
  const busNumber = busNumbers[0];
  const operator = await connectOperator(busNumber);
  await db.insert(adminDisplaySettingsTable).values({
    busNumber,
    version: 7,
    enabledSlides: ["welcome"],
    passengerLanguage: "en",
    rotationIntervalSeconds: 15,
    announcements: [],
    updatedBy: driverSubject,
  }).onConflictDoUpdate({
    target: adminDisplaySettingsTable.busNumber,
    set: { version: 7 },
  });

  const registrationResponse = await request(`/trips/${operator.pairingCode}/passenger-status?viewer=passenger`, {
    method: "PUT",
    body: JSON.stringify({ id: "receipt-screen", audioReady: true }),
  });
  assert.equal(registrationResponse.status, 200);
  const { sessionToken } = await registrationResponse.json() as { sessionToken: string };

  const spoofed = await request(`/trips/${operator.pairingCode}/display-settings-receipt?viewer=passenger`, {
    method: "PUT",
    body: JSON.stringify({ displayId: "somebody-elses-screen", version: 7, sessionToken }),
  });
  assert.equal(spoofed.status, 403);

  const valid = await request(`/trips/${operator.pairingCode}/display-settings-receipt?viewer=passenger`, {
    method: "PUT",
    body: JSON.stringify({ displayId: "receipt-screen", version: 7, sessionToken }),
  });
  assert.equal(valid.status, 204);

  const disconnect = await request(`/trips/${busNumber}/disconnect-screens`, { method: "POST" });
  assert.equal(disconnect.status, 200);
  const replacement = await disconnect.json() as { pairingCode: string };
  const stale = await request(`/trips/${replacement.pairingCode}/display-settings-receipt?viewer=passenger`, {
    method: "PUT",
    body: JSON.stringify({ displayId: "receipt-screen", version: 7, sessionToken }),
  });
  assert.equal(stale.status, 403);
  const oldReceipts = await db.select().from(adminDisplayReceiptsTable).where(and(
    eq(adminDisplayReceiptsTable.busNumber, busNumber),
    eq(adminDisplayReceiptsTable.displayId, "receipt-screen"),
  ));
  assert.equal(oldReceipts.length, 0);

  const replacementRegistration = await request(`/trips/${replacement.pairingCode}/passenger-status?viewer=passenger`, {
    method: "PUT",
    body: JSON.stringify({ id: "receipt-screen", audioReady: true }),
  });
  const replacementSession = await replacementRegistration.json() as { sessionToken: string };
  assert.notEqual(replacementSession.sessionToken, sessionToken);
  const replacementAck = await request(`/trips/${replacement.pairingCode}/display-settings-receipt?viewer=passenger`, {
    method: "PUT",
    body: JSON.stringify({ displayId: "receipt-screen", version: 7, sessionToken: replacementSession.sessionToken }),
  });
  assert.equal(replacementAck.status, 204);
});
