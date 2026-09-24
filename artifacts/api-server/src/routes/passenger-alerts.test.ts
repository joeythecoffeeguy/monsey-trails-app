import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alertHasExpired,
  alertThresholdReached,
  ARRIVING_NOW_DISTANCE_MILES,
  FINAL_DESTINATION_STOP_ID,
  isExpoPushToken,
  passengerAlertPushPayload,
  upcomingStopsForTrip,
} from "./passenger-alerts";

const stop = { id: "stop-1", address: "Main Street", lat: 40, lng: -73 };
const activeTrip = {
  status: "running" as const,
  retiredAt: null,
  passengerPairingCode: "1234",
  intermediateStops: [stop],
  destinationAddress: "Destination Avenue",
  destinationLat: 41,
  destinationLng: -72,
  eta: new Date(Date.now() + 180_000),
};

test("time alerts trigger at or below two minutes only", () => {
  const alert = { leadTime: "time-2m" as const };
  assert.equal(alertThresholdReached(alert, { etaSeconds: 120 }), true);
  assert.equal(alertThresholdReached(alert, { etaSeconds: 121 }), false);
  assert.equal(alertThresholdReached(alert, { etaSeconds: -1, remainingDistanceMiles: 20 }), false);
  assert.equal(alertThresholdReached(alert, { etaSeconds: null }), false);
  assert.equal(alertThresholdReached(alert, { remainingDistanceMiles: 0.1 }), false);
});

test("configurable time alerts use inclusive 15, 5, and 2 minute bounds", () => {
  for (const [leadTime, seconds] of [
    ["time-15m", 900],
    ["time-5m", 300],
    ["time-2m", 120],
  ] as const) {
    assert.equal(alertThresholdReached({ leadTime }, { etaSeconds: seconds }), true);
    assert.equal(alertThresholdReached({ leadTime }, { etaSeconds: seconds + 0.001 }), false);
  }
  assert.equal(alertThresholdReached({ leadTime: "time-15m" }, { etaSeconds: Number.POSITIVE_INFINITY }), false);
  assert.equal(alertThresholdReached({ leadTime: "time-5m" }, { etaSeconds: Number.NaN }), false);
  assert.equal(alertThresholdReached({ leadTime: "time-2m" }, { etaSeconds: -0.001 }), false);
});

test("arriving now has an honest inclusive 0.1 mile near-stop bound", () => {
  assert.equal(ARRIVING_NOW_DISTANCE_MILES, 0.1);
  assert.equal(alertThresholdReached({ leadTime: "arriving-now" }, { remainingDistanceMiles: 0.1 }), true);
  assert.equal(alertThresholdReached({ leadTime: "arriving-now" }, { remainingDistanceMiles: 0.100001 }), false);
  assert.equal(alertThresholdReached({ leadTime: "arriving-now" }, { remainingDistanceMiles: -0.1 }), false);
  assert.equal(alertThresholdReached({ leadTime: "arriving-now" }, { remainingDistanceMiles: Number.NaN }), false);
});

test("distance alerts trigger at or below half a mile only", () => {
  const alert = { leadTime: "distance-0.5mi" as const };
  assert.equal(alertThresholdReached(alert, { remainingDistanceMiles: 0.5 }), true);
  assert.equal(alertThresholdReached(alert, { remainingDistanceMiles: 0.51 }), false);
  assert.equal(alertThresholdReached(alert, { remainingDistanceMiles: null }), false);
  assert.equal(alertThresholdReached(alert, { remainingDistanceMiles: -1 }), false);
  assert.equal(alertThresholdReached(alert, { remainingDistanceMiles: Number.POSITIVE_INFINITY }), false);
  assert.equal(alertThresholdReached(alert, { etaSeconds: 30 }), false);
});

test("alerts expire when the trip or selected stop is no longer active", () => {
  const now = Date.now();
  assert.equal(alertHasExpired(activeTrip, { selectedStopId: "stop-1", expiresAt: null }, now), false);
  assert.equal(alertHasExpired({ ...activeTrip, retiredAt: new Date(now - 1) }, { selectedStopId: "stop-1", expiresAt: null }, now), true);
  assert.equal(alertHasExpired({ ...activeTrip, status: "stopped" }, { selectedStopId: "stop-1", expiresAt: null }, now), true);
  assert.equal(alertHasExpired(activeTrip, { selectedStopId: "stop-1", expiresAt: new Date(now - 1) }, now), true);
  assert.equal(alertHasExpired(activeTrip, { selectedStopId: "stop-2", expiresAt: null }, now), true);
});

test("running trips expose a stable final destination stop and retain it until trip end", () => {
  const finalStop = upcomingStopsForTrip(activeTrip).at(-1);
  assert.equal(finalStop?.id, FINAL_DESTINATION_STOP_ID);
  assert.equal(finalStop?.label, "Destination Avenue");
  assert.equal(finalStop?.eta, activeTrip.eta.toISOString());
  assert.equal(alertHasExpired(activeTrip, { selectedStopId: FINAL_DESTINATION_STOP_ID, expiresAt: null }, Date.now()), false);
  assert.equal(alertHasExpired({ ...activeTrip, status: "stopped" }, { selectedStopId: FINAL_DESTINATION_STOP_ID, expiresAt: null }, Date.now()), true);
  assert.equal(alertThresholdReached({ leadTime: "time-2m" }, { etaSeconds: 120 }), true);
  assert.equal(alertThresholdReached({ leadTime: "distance-0.5mi" }, { remainingDistanceMiles: 0.5 }), true);
});

test("Expo push token validation accepts Expo token formats without accepting arbitrary strings", () => {
  assert.equal(isExpoPushToken("ExponentPushToken[abc123+/=_-]"), true);
  assert.equal(isExpoPushToken("Expo[abc123]"), true);
  assert.equal(isExpoPushToken("not-a-token"), false);
  assert.equal(isExpoPushToken("ExponentPushToken[]"), false);
  assert.equal(isExpoPushToken(null), false);
});

test("sound preference selects an honest sounding or quiet provider payload", () => {
  const stop = { id: "stop-1", label: "Main Street" };
  const sounding = passengerAlertPushPayload(
    { expoPushToken: "ExponentPushToken[sound]", soundEnabled: true },
    stop,
    "en",
  );
  assert.equal(sounding.sound, "default");
  assert.equal(sounding.channelId, "passenger-alerts");
  const quiet = passengerAlertPushPayload(
    { expoPushToken: "ExponentPushToken[quiet]", soundEnabled: false },
    stop,
    "en",
  );
  assert.equal(quiet.sound, null);
  assert.equal(quiet.channelId, "passenger-alerts-quiet");
});
