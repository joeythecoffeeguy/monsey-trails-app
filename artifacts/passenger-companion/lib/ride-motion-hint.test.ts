import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRideMotion, type MotionSample } from './ride-motion-hint.ts';

function steadySamples(startMs: number, count: number, intervalMs: number, deviation: (index: number) => number): MotionSample[] {
  return Array.from({ length: count }, (_, index) => ({
    x: 0,
    y: 0,
    z: 1 + deviation(index),
    timestampMs: startMs + index * intervalMs,
  }));
}

test('requires sustained, repeated movement before offering a ride hint', () => {
  const samples = steadySamples(0, 42, 500, index => (index % 2 ? 0.11 : -0.11));
  const result = assessRideMotion(samples, 20_500);

  assert.equal(result.movementDetected, true);
  assert.ok(result.confidence > 0 && result.confidence <= 0.65);
  assert.notEqual(result.confidenceLabel, 'insufficient');
});

test('does not trigger for stationary sensor noise', () => {
  const samples = steadySamples(0, 42, 500, index => (index % 2 ? 0.008 : -0.008));
  const result = assessRideMotion(samples, 20_500);

  assert.equal(result.movementDetected, false);
  assert.equal(result.confidenceLabel, 'insufficient');
});

test('does not treat a brief jolt as sustained movement', () => {
  const samples = steadySamples(0, 42, 500, index => index >= 20 && index <= 22 ? 0.3 : 0.004);
  const result = assessRideMotion(samples, 20_500);

  assert.equal(result.movementDetected, false);
});

test('requires enough elapsed observations', () => {
  const samples = steadySamples(0, 20, 500, index => (index % 2 ? 0.12 : -0.12));
  const result = assessRideMotion(samples, 10_000);

  assert.equal(result.movementDetected, false);
  assert.equal(result.confidenceLabel, 'insufficient');
});