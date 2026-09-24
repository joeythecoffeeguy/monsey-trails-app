import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approachingPickupEventKey,
  approachingPickupThresholdReached,
  disruptionEventKey,
  transferRiskEventKey,
  transferAlertCooldownElapsed,
  transferRiskDeteriorated,
  transferRiskHasHysteresis,
} from "../lib/passenger-realtime";
import { parsePassengerRealtimeInput } from "./passenger-realtime";
import { passengerRealtimeCapabilityHash } from "./passenger-realtime";

const valid = {
  passengerCode: "1234",
  deviceId: "install-a",
  expoPushToken: "ExponentPushToken[realtime123]",
  runKey: "2026-09-17|1|5|2|run-a",
};

test("approaching pickup alert uses its independent inclusive ten-minute ETA threshold", () => {
  assert.equal(approachingPickupThresholdReached(600), true);
  assert.equal(approachingPickupThresholdReached(599), true);
  assert.equal(approachingPickupThresholdReached(601), false);
  assert.equal(approachingPickupThresholdReached(-1), false);
  assert.equal(approachingPickupThresholdReached(Number.NaN), false);
  assert.equal(approachingPickupThresholdReached(null), false);
});

test("approaching pickup re-opt-in gets a new generation while repeated POST keeps its key", () => {
  assert.equal(approachingPickupEventKey("subscription-a", 0), "approaching-pickup:subscription-a:0");
  assert.notEqual(
    approachingPickupEventKey("subscription-a", 0),
    approachingPickupEventKey("subscription-a", 1),
  );
});

test("transfer deterioration is one-way, ranked, and cooled down", () => {
  const now = new Date("2026-09-17T12:02:00.000Z");
  assert.equal(transferRiskDeteriorated("possible", "tight"), true);
  assert.equal(transferRiskDeteriorated("tight", "at_risk"), true);
  assert.equal(transferRiskDeteriorated("at_risk", "possible"), false);
  assert.equal(transferRiskDeteriorated("tight", "tight"), false);
  assert.equal(transferAlertCooldownElapsed(new Date(now.getTime() - 120_000), now), true);
  assert.equal(transferAlertCooldownElapsed(new Date(now.getTime() - 119_999), now), false);
});

test("transfer alert hysteresis avoids warning on a one-minute fluctuation", () => {
  assert.equal(transferRiskHasHysteresis("possible", "tight", 14, 15), false);
  assert.equal(transferRiskHasHysteresis("possible", "tight", 13, 15), true);
  assert.equal(transferRiskHasHysteresis("tight", "at_risk", -1, 15), false);
  assert.equal(transferRiskHasHysteresis("tight", "at_risk", -2, 15), true);
});

test("realtime subscriptions require flow-specific pickup or exact transfer selection", () => {
  const disruption = parsePassengerRealtimeInput({ ...valid, flow: "disruption" });
  assert.equal(disruption?.flow, "disruption");
  assert.equal(parsePassengerRealtimeInput({
    ...valid, flow: "approaching-pickup",
  }), null);
  const pickup = parsePassengerRealtimeInput({
    ...valid, flow: "approaching-pickup", selectedStopId: "official-pickup-1",
  });
  assert.equal(pickup?.selectedStopId, "official-pickup-1");
  assert.equal(parsePassengerRealtimeInput({
    ...valid,
    flow: "transfer-risk",
    onwardRunKey: "2026-09-17|1|2|5|run-b",
    transferAreaId: 2,
    minimumBufferMinutes: 15,
  }), null);
  const transfer = parsePassengerRealtimeInput({
    ...valid,
    flow: "transfer-risk",
    selectedStopId: "verified-shared-stop",
    onwardRunKey: "2026-09-17|1|2|5|run-b",
    transferAreaId: 2,
    minimumBufferMinutes: 15,
  });
  assert.equal(transfer?.flow, "transfer-risk");
  assert.equal(parsePassengerRealtimeInput({
    ...valid, flow: "disruption", selectedStopId: "arbitrary-stop",
  }), null);
  assert.equal(parsePassengerRealtimeInput({
    ...valid, flow: "disruption", expoPushToken: "not-an-expo-token",
  }), null);
});

test("event keys distinguish notice revisions and transfer status transitions", () => {
  const changedAt = new Date("2026-09-17T12:00:00.000Z");
  assert.notEqual(
    disruptionEventKey("notice-a", "created", changedAt),
    disruptionEventKey("notice-a", "updated", changedAt),
  );
  assert.notEqual(
    transferRiskEventKey("subscription-a", "possible", "at_risk", changedAt),
    transferRiskEventKey("subscription-a", "at_risk", "possible", changedAt),
  );
});

test("installation ownership stores only a one-way capability digest", () => {
  const first = passengerRealtimeCapabilityHash("a".repeat(43));
  const second = passengerRealtimeCapabilityHash("b".repeat(43));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
});