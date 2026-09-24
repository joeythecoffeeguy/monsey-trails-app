import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPublishedTransfer, parseExactRunKey } from "./passenger-transfers";
import type { ResolvedOfficialRun } from "./schedule";

function run(
  runKey: string,
  serviceDate: string,
  scheduledDepartureAt: string,
  scheduledArrivalAt: string,
  stops: ResolvedOfficialRun["stops"],
): ResolvedOfficialRun {
  return {
    runKey,
    routeCode: "published-route",
    originName: "Origin",
    destinationName: "Destination",
    serviceDate,
    scheduledDepartureAt,
    scheduledArrivalAt,
    arrivalVerification: "verified",
    trafficDepartureAt: scheduledDepartureAt,
    stops,
  };
}

const incomingStop = {
  id: "official-incoming-1",
  label: "Main Street & First Avenue",
  mapLabel: "Main Street & First Avenue",
  lat: 41,
  lng: -74,
  kind: "dropoff" as const,
  scheduledAt: "2026-09-17T03:50:00.000Z",
  areaId: 2,
};

const onwardStop = {
  ...incomingStop,
  id: "official-onward-1",
  kind: "pickup" as const,
  scheduledAt: "2026-09-17T04:20:00.000Z",
};

const incoming = run(
  "2026-09-16|1|5|2|exact-incoming",
  "2026-09-16",
  "2026-09-17T02:00:00.000Z",
  incomingStop.scheduledAt,
  [incomingStop],
);
const onward = run(
  "2026-09-17|1|2|5|exact-onward",
  "2026-09-17",
  onwardStop.scheduledAt,
  "2026-09-17T05:30:00.000Z",
  [onwardStop],
);

test("accepts only exact date-bound run keys", () => {
  assert.deepEqual(parseExactRunKey("2026-09-16|1|5|2|run-42"), {
    date: "2026-09-16",
    line: 1,
    origin: 5,
    destination: 2,
    runId: "run-42",
  });
  assert.equal(parseExactRunKey("2026-09-16|1|5|2"), null);
  assert.equal(parseExactRunKey("bad-date|1|5|2|run-42"), null);
  assert.equal(parseExactRunKey("2026-09-16|9|5|2|run-42"), null);
});

test("handles an overnight published transfer using absolute instants", () => {
  const result = assessPublishedTransfer({
    incoming,
    onward,
    incomingJourney: {
      runKey: incoming.runKey,
      originName: "Origin",
      destinationName: "Destination",
      serviceDate: incoming.serviceDate,
      scheduledDepartureAt: incoming.scheduledDepartureAt,
      scheduledArrivalAt: incoming.scheduledArrivalAt,
      arrivalVerification: "verified",
      stops: [{ ...incomingStop, estimatedArrivalAt: null }],
      routeGeometry: [],
      trafficUpdatedAt: null,
      trafficStatus: "unavailable",
      message: null,
    },
    transferAreaId: 2,
    minimumBufferMinutes: 15,
  });
  assert.equal(result?.bufferMinutes, 30);
  assert.equal(result?.arrivalBasis, "scheduled");
  assert.equal(result?.connectionStatus, "possible");
});

test("returns no option when no published service candidates exist", () => {
  const options = ([] as ResolvedOfficialRun[]).flatMap(candidate => {
    const result = assessPublishedTransfer({
      incoming,
      onward: candidate,
      incomingJourney: {} as never,
      transferAreaId: 2,
      minimumBufferMinutes: 15,
    });
    return result ? [result] : [];
  });
  assert.deepEqual(options, []);
});

test("rejects an impossible transfer without a verified shared stop", () => {
  const mismatched = {
    ...onward,
    stops: [{ ...onwardStop, label: "Different Terminal" }],
  };
  const result = assessPublishedTransfer({
    incoming,
    onward: mismatched,
    incomingJourney: {
      stops: [],
      trafficStatus: "unavailable",
    } as never,
    transferAreaId: 2,
    minimumBufferMinutes: 15,
  });
  assert.equal(result, null);
});

test("fresh live arrival explicitly marks a published connection at risk", () => {
  const liveNow = Date.parse("2026-09-17T03:40:00.000Z");
  const result = assessPublishedTransfer({
    incoming,
    onward,
    incomingJourney: {
      runKey: incoming.runKey,
      originName: "Origin",
      destinationName: "Destination",
      serviceDate: incoming.serviceDate,
      scheduledDepartureAt: incoming.scheduledDepartureAt,
      scheduledArrivalAt: incoming.scheduledArrivalAt,
      arrivalVerification: "verified",
      stops: [{ ...incomingStop, estimatedArrivalAt: "2026-09-17T04:25:00.000Z" }],
      routeGeometry: [],
      trafficUpdatedAt: "2026-09-17T03:40:00.000Z",
      trafficStatus: "live",
      message: null,
    },
    transferAreaId: 2,
    minimumBufferMinutes: 15,
    now: liveNow,
  });
  assert.equal(result?.arrivalBasis, "live");
  assert.equal(result?.bufferMinutes, -5);
  assert.equal(result?.connectionStatus, "at_risk");
  assert.match(result?.warning ?? "", /not guaranteed/i);
});

test("stale or schedule-fallback arrival never advertises live transfer risk", () => {
  const staleResult = assessPublishedTransfer({
    incoming,
    onward,
    incomingJourney: {
      runKey: incoming.runKey,
      originName: "Origin",
      destinationName: "Destination",
      serviceDate: incoming.serviceDate,
      scheduledDepartureAt: incoming.scheduledDepartureAt,
      scheduledArrivalAt: incoming.scheduledArrivalAt,
      arrivalVerification: "verified",
      stops: [{ ...incomingStop, estimatedArrivalAt: "2026-09-17T04:25:00.000Z" }],
      routeGeometry: [],
      trafficUpdatedAt: "2026-09-17T03:30:00.000Z",
      trafficStatus: "live",
      message: null,
    },
    transferAreaId: 2,
    minimumBufferMinutes: 15,
    now: Date.parse("2026-09-17T03:40:00.000Z"),
  });
  assert.equal(staleResult?.arrivalBasis, "scheduled");
  assert.equal(staleResult?.connectionStatus, "possible");

  const fallbackResult = assessPublishedTransfer({
    incoming,
    onward,
    incomingJourney: {
      runKey: incoming.runKey,
      originName: "Origin",
      destinationName: "Destination",
      serviceDate: incoming.serviceDate,
      scheduledDepartureAt: incoming.scheduledDepartureAt,
      scheduledArrivalAt: incoming.scheduledArrivalAt,
      arrivalVerification: "verified",
      stops: [{ ...incomingStop, estimatedArrivalAt: incomingStop.scheduledAt }],
      routeGeometry: [],
      trafficUpdatedAt: "2026-09-17T03:40:00.000Z",
      trafficStatus: "live",
      message: null,
    },
    transferAreaId: 2,
    minimumBufferMinutes: 15,
    now: Date.parse("2026-09-17T03:40:00.000Z"),
  });
  assert.equal(fallbackResult?.arrivalBasis, "scheduled");
});