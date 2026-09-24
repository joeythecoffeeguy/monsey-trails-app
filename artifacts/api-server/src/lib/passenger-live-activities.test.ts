import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import type { LiveTripRow } from "@workspace/db";
import {
  APNS_TOPIC,
  LIVE_ACTIVITY_TICK_BATCH_SIZE,
  PASSENGER_LIVE_ACTIVITY_NAME,
  TOKENLESS_TERMINAL_GRACE_MS,
  apnsConfigurationAvailable,
  buildApnsLiveActivityPayload,
  isExpiredTokenlessTerminalActivity,
  isLiveActivityPushToken,
  liveActivityPropsForTrip,
  processPassengerLiveActivityBatches,
  verifiedLiveActivityStops,
} from "./passenger-live-activities";
import { passengerRealtimeCapabilityHash } from "../routes/passenger-realtime";
import {
  exceedsPassengerLiveActivityRegistrationLimits,
  MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION,
  MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION_TRIP,
  MAX_ACTIVE_LIVE_ACTIVITIES_PER_TRIP,
  passengerLiveActivityRegistrationAttemptAllowed,
  recordPassengerLiveActivityRegistrationFailure,
} from "./passenger-live-activity-registration-guard";

const now = Date.parse("2026-09-17T12:00:00.000Z");
const activity = {
  pickupStopId: "pickup-1",
  dropoffStopId: "dropoff-1",
  pickupStopName: "Main Street",
  dropoffStopName: "Railroad Avenue",
  pickupStopLat: 41.1,
  pickupStopLng: -74.1,
  dropoffStopLat: 41.2,
  dropoffStopLng: -74.2,
  lineName: "Route 1",
  coachNumber: "42",
};

function trip(overrides: Partial<LiveTripRow> = {}) {
  return {
    pairingCode: "42",
    status: "running",
    destinationAddress: "Railroad Avenue",
    destinationLat: 41.2,
    destinationLng: -74.2,
    intermediateStops: [
      { id: "pickup-1", address: "Main Street", lat: 41.1, lng: -74.1, eta: new Date(now + 5 * 60_000).toISOString() },
      { id: "dropoff-1", address: "Railroad Avenue", lat: 41.2, lng: -74.2, eta: new Date(now + 30 * 60_000).toISOString() },
    ],
    routeGeometry: [],
    originLat: 41,
    originLng: -74,
    currentLat: 41.05,
    currentLng: -74.05,
    locationUpdatedAt: new Date(now - 10_000),
    totalDistanceMiles: 3,
    remainingDistanceMiles: 3,
    eta: new Date(now + 30 * 60_000),
    speedMph: 25,
    startedAt: new Date(now - 60 * 60_000),
    emergencyOverride: false,
    emergencyMessage: "",
    routeId: "route-1",
    displayMode: "auto",
    passengerLanguage: "en",
    rotationIntervalSeconds: 15,
    arrivalSoundsEnabled: true,
    announcements: [],
    passengerLastSeenAt: null,
    chimeTestRequestedAt: null,
    lastPushNotifiedStopKey: null,
    retiredAt: null,
    passengerPairingCode: "1234",
    officialRunKey: "2026-09-17|1|5|2|run-a",
    ownerSubject: "driver-a",
    scheduledDepartureAt: new Date(now - 60 * 60_000),
    completedAt: null,
    updatedAt: new Date(now),
    createdAt: new Date(now - 60 * 60_000),
    ...overrides,
  } as LiveTripRow;
}

test("capability ownership uses the existing installation hash and separates owners", () => {
  const first = passengerRealtimeCapabilityHash("installation-capability-one");
  const same = passengerRealtimeCapabilityHash("installation-capability-one");
  const other = passengerRealtimeCapabilityHash("installation-capability-two");
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.equal(first.length, 64);
});

test("Live Activity selection requires an official pickup followed by an official dropoff", () => {
  const stops = [
    { id: "pickup", kind: "pickup" as const },
    { id: "dropoff", kind: "dropoff" as const },
  ];
  assert.deepEqual(verifiedLiveActivityStops(stops, "pickup", "dropoff"), {
    pickup: stops[0], dropoff: stops[1],
  });
  assert.equal(verifiedLiveActivityStops(stops, "dropoff", "pickup"), null);
  assert.equal(verifiedLiveActivityStops(stops, "dropoff", "dropoff"), null);
  assert.equal(verifiedLiveActivityStops(stops, "invented", "dropoff"), null);
});

test("trip progress changes from pickup to onboard and ends at the selected dropoff", () => {
  const pickupProps = liveActivityPropsForTrip(activity, trip(), now);
  assert.equal(pickupProps.phase, "pickup");
  assert.equal(pickupProps.stopName, "Main Street");
  assert.equal(pickupProps.etaLabel, "5 min");

  const onboardProps = liveActivityPropsForTrip(activity, trip({
    intermediateStops: [{
      id: "dropoff-1", address: "Railroad Avenue", lat: 41.2, lng: -74.2,
      eta: new Date(now + 30 * 60_000).toISOString(),
    }],
  }), now);
  assert.equal(onboardProps.phase, "onboard");
  assert.equal(onboardProps.stopName, "Railroad Avenue");

  const endedProps = liveActivityPropsForTrip(activity, trip({
    intermediateStops: [],
    destinationAddress: "Elsewhere",
    destinationLat: 40,
    destinationLng: -73,
  }), now);
  assert.equal(endedProps.phase, "ended");
  assert.equal(endedProps.etaLabel, "Trip ended");
});

test("stale or hidden GPS suppresses countdown and emits unavailable phase", () => {
  const stale = liveActivityPropsForTrip(activity, trip({
    locationUpdatedAt: new Date(now - 90_001),
  }), now);
  assert.equal(stale.phase, "unavailable");
  assert.equal(stale.etaLabel, "ETA unavailable");

  const hidden = liveActivityPropsForTrip(activity, trip({
    scheduledDepartureAt: new Date(now + 60_000),
  }), now);
  assert.equal(hidden.phase, "unavailable");
  assert.equal(hidden.etaLabel, "ETA unavailable");
});

test("APNs payload uses the activity contract, Live Activity topic and end event", () => {
  const props = liveActivityPropsForTrip(activity, trip(), now);
  assert.deepEqual(Object.keys(props).sort(), [
    "coachNumber", "etaLabel", "lineName", "phase", "status", "stopName", "updatedAt",
  ]);
  const payload = buildApnsLiveActivityPayload(props, now);
  assert.equal(payload.aps.event, "update");
  assert.equal(payload.aps["content-state"].name, PASSENGER_LIVE_ACTIVITY_NAME);
  assert.deepEqual(JSON.parse(payload.aps["content-state"].props), props);
  assert.equal(payload.aps.timestamp, Math.floor(now / 1000));
  assert.equal(payload.aps["stale-date"], Math.floor(now / 1000) + 90);
  assert.equal(APNS_TOPIC, "app.replit.monseytrailspassenger.push-type.liveactivity");
  assert.equal(buildApnsLiveActivityPayload({ ...props, phase: "ended" }, now).aps.event, "end");
});

test("token and APNs availability checks reject malformed or incomplete configuration", () => {
  assert.equal(isLiveActivityPushToken("a".repeat(64)), true);
  assert.equal(isLiveActivityPushToken("not-a-token"), false);
  const privateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    type: "pkcs8", format: "pem",
  }).toString();
  assert.equal(apnsConfigurationAvailable({
    APNS_TEAM_ID: "TEAM",
    APNS_KEY_ID: "KEY",
    APNS_PRIVATE_KEY: privateKey,
    APNS_BUNDLE_ID: "app.replit.monseytrailspassenger",
    APNS_ENVIRONMENT: "sandbox",
  }), true);
  assert.equal(apnsConfigurationAvailable({
    APNS_TEAM_ID: "TEAM",
    APNS_KEY_ID: "KEY",
    APNS_PRIVATE_KEY: privateKey.replace(/\n/g, ""),
    APNS_ENVIRONMENT: "production",
  }), true);
  assert.equal(apnsConfigurationAvailable({
    APNS_TEAM_ID: "TEAM",
    APNS_KEY_ID: "KEY",
    APNS_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"),
    APNS_ENVIRONMENT: "production",
  }), true);
  assert.equal(apnsConfigurationAvailable({
    APNS_TEAM_ID: "TEAM",
    APNS_KEY_ID: "KEY",
    APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----broken!-----END PRIVATE KEY-----",
    APNS_ENVIRONMENT: "production",
  }), false);
  assert.equal(apnsConfigurationAvailable({
    APNS_TEAM_ID: "TEAM",
    APNS_KEY_ID: "KEY",
    APNS_PRIVATE_KEY: privateKey,
    APNS_BUNDLE_ID: "incorrect.bundle",
    APNS_ENVIRONMENT: "sandbox",
  }), false);
});

test("ended tokenless activities stay available for late tokens, then expire after a bounded grace", () => {
  const endedAt = new Date(now);
  const oldEnough = {
    active: true,
    phase: "ended" as const,
    pushToken: null,
    endedAt,
    updatedAt: endedAt,
  };
  assert.equal(isExpiredTokenlessTerminalActivity(oldEnough, now + TOKENLESS_TERMINAL_GRACE_MS - 1), false);
  assert.equal(isExpiredTokenlessTerminalActivity(oldEnough, now + TOKENLESS_TERMINAL_GRACE_MS), true);
  assert.equal(isExpiredTokenlessTerminalActivity({ ...oldEnough, pushToken: "a".repeat(64) }, now + TOKENLESS_TERMINAL_GRACE_MS), false);
  assert.equal(isExpiredTokenlessTerminalActivity({ ...oldEnough, phase: "onboard" }, now + TOKENLESS_TERMINAL_GRACE_MS), false);
  assert.equal(isExpiredTokenlessTerminalActivity({ ...oldEnough, active: false }, now + TOKENLESS_TERMINAL_GRACE_MS), false);
  assert.equal(isExpiredTokenlessTerminalActivity({ ...oldEnough, endedAt: null }, now + TOKENLESS_TERMINAL_GRACE_MS - 1), false);
  assert.equal(isExpiredTokenlessTerminalActivity({ ...oldEnough, endedAt: null }, now + TOKENLESS_TERMINAL_GRACE_MS), true);
});

test("Live Activity tick keyset batches process every active row beyond the first 500", async () => {
  const rows = Array.from({ length: LIVE_ACTIVITY_TICK_BATCH_SIZE * 2 + 137 }, (_, index) => ({
    id: `activity-${String(index).padStart(5, "0")}`,
  }));
  const processed: string[] = [];
  const batchSizes: number[] = [];
  const loadBatch = async (afterId: string | null, limit: number) => rows
    .filter(row => afterId === null || row.id > afterId)
    .slice(0, limit);
  const total = await processPassengerLiveActivityBatches(loadBatch, async batch => {
    batchSizes.push(batch.length);
    processed.push(...batch.map(row => row.id));
  });
  assert.equal(total, rows.length);
  assert.deepEqual(batchSizes, [500, 500, 137]);
  assert.deepEqual(processed, rows.map(row => row.id));
  assert.equal(new Set(processed).size, rows.length);
});

test("registration guards bound installation and trip counts and throttle failed attempts", () => {
  assert.equal(MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION, 10);
  assert.equal(MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION_TRIP, 3);
  assert.equal(MAX_ACTIVE_LIVE_ACTIVITIES_PER_TRIP, 500);
  assert.equal(exceedsPassengerLiveActivityRegistrationLimits({ installation: 9, installationTrip: 2, trip: 499 }), false);
  assert.equal(exceedsPassengerLiveActivityRegistrationLimits({ installation: 10, installationTrip: 0, trip: 0 }), true);
  assert.equal(exceedsPassengerLiveActivityRegistrationLimits({ installation: 0, installationTrip: 3, trip: 0 }), true);
  assert.equal(exceedsPassengerLiveActivityRegistrationLimits({ installation: 0, installationTrip: 0, trip: 500 }), true);

  const time = now + 100_000;
  const ip = "test-ip-live-activity";
  const installation = "test-installation-live-activity";
  for (let failure = 0; failure < 10; failure += 1) {
    assert.equal(passengerLiveActivityRegistrationAttemptAllowed(ip, installation, time), true);
    recordPassengerLiveActivityRegistrationFailure(ip, installation, time);
  }
  assert.equal(passengerLiveActivityRegistrationAttemptAllowed(ip, installation, time), false);
  assert.equal(passengerLiveActivityRegistrationAttemptAllowed(ip, "different-installation", time), true);
  assert.equal(passengerLiveActivityRegistrationAttemptAllowed(ip, installation, time + 15 * 60_000), true);
});