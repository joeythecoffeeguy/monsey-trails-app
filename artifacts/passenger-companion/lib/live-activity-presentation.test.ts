import assert from 'node:assert/strict';
import test from 'node:test';
import { passengerTripActivityProps } from './live-activity-presentation.ts';

const base = {
  lineName: 'Monsey → Manhattan',
  coachNumber: '12',
  pickupStopId: 'pickup',
  pickupLabel: 'Main St & 3rd Ave',
  dropoffStopId: 'dropoff',
  dropoffLabel: '42nd St & 8th Ave',
  tripStatus: 'running',
  locationIsLive: true,
  locationUpdatedAt: '2026-09-24T12:00:00.000Z',
  progress: [
    { id: 'pickup', status: 'current', eta: '2026-09-24T12:08:00.000Z' },
    { id: 'dropoff', status: 'upcoming', eta: '2026-09-24T13:10:00.000Z' },
  ],
};
const now = Date.parse('2026-09-24T12:00:30.000Z');

test('pickup switches to onboard only after the pickup completes', () => {
  assert.equal(passengerTripActivityProps(base, now).phase, 'pickup');
  const onboard = passengerTripActivityProps({
    ...base,
    progress: [
      { id: 'pickup', status: 'completed', eta: null },
      { id: 'dropoff', status: 'upcoming', eta: '2026-09-24T13:10:00.000Z' },
    ],
  }, now);
  assert.equal(onboard.phase, 'onboard');
  assert.equal(onboard.stopName, base.dropoffLabel);
  assert.equal(onboard.status, 'To your drop-off');
});

test('old GPS never keeps a live countdown', () => {
  const stale = passengerTripActivityProps(base, now + 120_000);
  assert.equal(stale.phase, 'unavailable');
  assert.equal(stale.etaLabel, 'Check app');
});

test('completed destination ends the activity', () => {
  const ended = passengerTripActivityProps({
    ...base,
    progress: [
      { id: 'pickup', status: 'completed', eta: null },
      { id: 'dropoff', status: 'completed', eta: null },
    ],
  }, now);
  assert.equal(ended.phase, 'ended');
});

test('a non-running but non-terminal snapshot does not end a tracked activity', () => {
  const notConfirmed = passengerTripActivityProps({
    ...base,
    tripStatus: 'ready',
  }, now);
  assert.equal(notConfirmed.phase, 'unavailable');
  assert.equal(notConfirmed.status, 'Trip status unavailable');
});