import assert from "node:assert/strict";
import test from "node:test";
import {
  evenlySpacedRouteSamples,
  trafficDurationMultiplier,
} from "./traffic-routing";

test("samples the full route at evenly spaced distances", () => {
  const samples = evenlySpacedRouteSamples([
    { lat: 40, lng: -74 },
    { lat: 40.01, lng: -74 },
    { lat: 40.02, lng: -74 },
    { lat: 40.03, lng: -74 },
  ], 3);
  assert.equal(samples.length, 3);
  assert.deepEqual(samples[0], { lat: 40.01, lng: -74 });
  assert.deepEqual(samples.at(-1), { lat: 40.03, lng: -74 });
});

test("uses current versus free-flow travel times to calculate delay", () => {
  assert.equal(trafficDurationMultiplier([
    { currentTravelTime: 20, freeFlowTravelTime: 10, confidence: 1 },
    { currentTravelTime: 10, freeFlowTravelTime: 10, confidence: 1 },
    { currentTravelTime: 30, freeFlowTravelTime: 10, confidence: 1 },
  ]), 2);
});

test("requires enough confident live traffic samples", () => {
  assert.equal(trafficDurationMultiplier([
    { currentSpeed: 15, freeFlowSpeed: 30, confidence: 1 },
    { currentSpeed: 20, freeFlowSpeed: 30, confidence: 0.2 },
  ]), null);
});