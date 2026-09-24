import assert from "node:assert/strict";
import test from "node:test";
import type { LiveTripRow } from "@workspace/db";
import { instructionLifecyclePatch, matchesAssignmentScope, stoppedSafety } from "./operations-communications";

const NOW = new Date("2026-09-22T18:30:00.000Z");

function trip(overrides: Partial<LiveTripRow> = {}): LiveTripRow {
  return {
    pairingCode: "417",
    status: "running",
    destinationAddress: "",
    destinationLat: null,
    destinationLng: null,
    intermediateStops: [],
    routeGeometry: [],
    originLat: null,
    originLng: null,
    currentLat: 41.1,
    currentLng: -74.1,
    locationUpdatedAt: new Date(NOW.getTime() - 5_000),
    totalDistanceMiles: null,
    remainingDistanceMiles: null,
    eta: null,
    speedMph: 0,
    startedAt: NOW,
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
    officialRunKey: "2026-09-22|1|3|2|100",
    ownerSubject: "driver-1",
    scheduledDepartureAt: NOW,
    completedAt: null,
    updatedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

test("driver communications fail closed for moving, unknown, and stale telemetry", () => {
  assert.equal(stoppedSafety(trip({ speedMph: 2 }), NOW.getTime()).stopped, false);
  assert.equal(stoppedSafety(trip({ speedMph: null }), NOW.getTime()).stopped, false);
  assert.equal(stoppedSafety(trip({ locationUpdatedAt: new Date(NOW.getTime() - 30_001) }), NOW.getTime()).stopped, false);
  assert.equal(stoppedSafety(trip({ currentLat: null }), NOW.getTime()).stopped, false);
  assert.equal(stoppedSafety(trip({ completedAt: NOW }), NOW.getTime()).stopped, false);
});

test("fresh stopped telemetry permits one-tap reports and acknowledgment", () => {
  assert.equal(stoppedSafety(trip(), NOW.getTime()).stopped, true);
  assert.equal(stoppedSafety(trip({ status: "ready" }), NOW.getTime()).stopped, true);
});

test("delivery time is write-once and acknowledgment is explicit", () => {
  const deliveredAt = new Date(NOW.getTime() - 10_000);
  assert.deepEqual(
    instructionLifecyclePatch({ deliveredAt, acknowledgedAt: null }, "delivered", NOW),
    { deliveredAt, acknowledgedAt: null },
  );
  assert.deepEqual(
    instructionLifecyclePatch({ deliveredAt, acknowledgedAt: null }, "acknowledged", NOW),
    { deliveredAt, acknowledgedAt: NOW },
  );
  assert.deepEqual(
    instructionLifecyclePatch({ deliveredAt: null, acknowledgedAt: null }, "delivered", NOW),
    { deliveredAt: NOW, acknowledgedAt: null },
  );
});

test("assignment scope rejects another driver, coach, run, or assignment", () => {
  const scope = {
    assignmentId: 17,
    driverSubject: "driver-1",
    busNumber: "417",
    officialRunKey: "2026-09-22|1|3|2|100",
  };
  assert.equal(matchesAssignmentScope(scope, scope), true);
  assert.equal(matchesAssignmentScope(scope, { ...scope, driverSubject: "driver-2" }), false);
  assert.equal(matchesAssignmentScope(scope, { ...scope, busNumber: "418" }), false);
  assert.equal(matchesAssignmentScope(scope, { ...scope, officialRunKey: "2026-09-22|1|3|2|101" }), false);
  assert.equal(matchesAssignmentScope(scope, { ...scope, assignmentId: 18 }), false);
});