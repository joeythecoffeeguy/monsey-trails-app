import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyStopCoordinatesToActiveTrip,
  effectiveStopCategory,
  removalTargetsActiveFinalLeg,
  shouldPreserveActiveTripRoute,
} from "./admin-stops";
import {
  scheduledStopChangeCanBeQueued,
  scheduledStopChangeIsDue,
} from "../lib/scheduled-stop-changes";

const auditedStop = {
  canonicalLabel: "18th Avenue & 50th Street",
  sourceLabel: "18th Avenue & 50th Street",
};

test("manual database category takes precedence over the published default", () => {
  assert.equal(effectiveStopCategory("pickup", undefined), "pickup");
  assert.equal(effectiveStopCategory("pickup", { category: "dropoff" }), "dropoff");
  assert.equal(effectiveStopCategory("dropoff", { category: "both" }), "both");
});

test("stop coordinate edits update matching active trip pins and clear their stale ETA", () => {
  const result = applyStopCoordinatesToActiveTrip({
    destinationAddress: "Lakewood",
    destinationLat: 40.1,
    destinationLng: -74.2,
    intermediateStops: [
      { id: "official-stop", address: "Pickup point", lat: 40.635, lng: -73.99, eta: "2026-09-22T12:00:00.000Z" },
      { id: "custom-stop", address: "Custom stop", lat: 40.7, lng: -73.9 },
    ],
  }, auditedStop, { lat: 40.635, lng: -73.99 }, { lat: 40.636, lng: -73.991 });

  assert.deepEqual(result, {
    intermediateStops: [
      { id: "official-stop", address: "Pickup point", lat: 40.636, lng: -73.991 },
      { id: "custom-stop", address: "Custom stop", lat: 40.7, lng: -73.9 },
    ],
  });
});

test("stop coordinate edits update a matching destination without changing custom stops", () => {
  const result = applyStopCoordinatesToActiveTrip({
    destinationAddress: auditedStop.canonicalLabel,
    destinationLat: 1,
    destinationLng: 2,
    intermediateStops: [
      { id: "custom-stop", address: "Custom stop", lat: 3, lng: 4 },
    ],
  }, auditedStop, { lat: 1, lng: 2 }, { lat: 5, lng: 6 });

  assert.deepEqual(result, {
    destinationAddress: auditedStop.canonicalLabel,
    destinationLat: 5,
    destinationLng: 6,
    intermediateStops: [
      { id: "custom-stop", address: "Custom stop", lat: 3, lng: 4 },
    ],
  });
});

test("a same-named stop in another area does not block removal", () => {
  const trip = {
    status: "running",
    intermediateStops: [],
    destinationAddress: "Kennedy Boulevard & Squankum Road",
  };
  const labels = {
    canonicalLabel: "Kennedy Boulevard & Squankum Road",
    sourceLabel: "Kennedy Boulevard & Squankum Road",
  };
  assert.equal(removalTargetsActiveFinalLeg(trip, 7, 8, labels), false);
  assert.equal(removalTargetsActiveFinalLeg(trip, 7, 7, labels), true);
});

test("running coach routes are preserved while ready routes may be rebuilt", () => {
  assert.equal(shouldPreserveActiveTripRoute("running"), true);
  assert.equal(shouldPreserveActiveTripRoute("ready"), false);
  assert.equal(shouldPreserveActiveTripRoute("stopped"), false);
});

test("scheduled changes become due only after their durable apply time", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");
  assert.equal(scheduledStopChangeCanBeQueued(new Date("2026-09-23T12:01:00.000Z"), now), true);
  assert.equal(scheduledStopChangeCanBeQueued(new Date("2026-09-23T12:00:59.999Z"), now), false);
  assert.equal(scheduledStopChangeIsDue({
    state: "queued",
    applyAt: new Date("2026-09-23T12:00:00.000Z"),
  }, now), true);
  assert.equal(scheduledStopChangeIsDue({
    state: "applied",
    applyAt: new Date("2026-09-23T11:00:00.000Z"),
  }, now), false);
});