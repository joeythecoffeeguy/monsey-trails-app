import assert from 'node:assert/strict';
import test from 'node:test';
import { canOptInToPassengerLiveActivity } from './passenger-live-activity-eligibility.ts';

const eligible = {
  tripStatus: 'running',
  tripAssigned: true,
  tripSnapshotCurrent: true,
  publishedRunVerified: true,
  passengerCode: '1234',
  pickupStopId: 'pickup-1',
  dropoffStopId: 'dropoff-1',
};

test('opt-in requires a current assigned running trip and both verified exact stops', () => {
  assert.equal(canOptInToPassengerLiveActivity(eligible), true);
  assert.equal(canOptInToPassengerLiveActivity({ ...eligible, tripStatus: 'ready' }), false);
  assert.equal(canOptInToPassengerLiveActivity({ ...eligible, tripSnapshotCurrent: false }), false);
  assert.equal(canOptInToPassengerLiveActivity({ ...eligible, publishedRunVerified: false }), false);
  assert.equal(canOptInToPassengerLiveActivity({ ...eligible, tripAssigned: false }), false);
});

test('opt-in rejects missing, malformed, or identical stop/code identifiers', () => {
  assert.equal(canOptInToPassengerLiveActivity({ ...eligible, passengerCode: null }), false);
  assert.equal(canOptInToPassengerLiveActivity({ ...eligible, passengerCode: '12345' }), false);
  assert.equal(canOptInToPassengerLiveActivity({ ...eligible, pickupStopId: undefined }), false);
  assert.equal(canOptInToPassengerLiveActivity({ ...eligible, dropoffStopId: 'pickup-1' }), false);
});