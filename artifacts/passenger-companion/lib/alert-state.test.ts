import test from 'node:test';
import assert from 'node:assert/strict';
import { alertPayload, isRestorableAlert, makeAlertSelection } from './alert-state.ts';

const trip = { operatorPairingCode: 'coach-1', passengerCode: '1234', active: true, upcomingStops: [{ id: 'a' }, { id: 'b' }] };
test('builds exact payload after an enabled stop change', () => {
  const selection = makeAlertSelection(trip, 'b', 'time-5m', false);
  assert.deepEqual(alertPayload(selection, 'device', 'ExponentPushToken[x]'), { passengerCode: '1234', deviceId: 'device', expoPushToken: 'ExponentPushToken[x]', selectedStopId: 'b', leadTime: 'time-5m', soundEnabled: false });
});
test('builds exact payload after an enabled lead change', () => {
  const selection = makeAlertSelection(trip, 'a', 'distance-0.5mi', true);
  assert.equal(alertPayload(selection, 'device', 'token').leadTime, 'distance-0.5mi');
});
test('accepts valid restart restoration and rejects stale identity or stop', () => {
  const valid = makeAlertSelection(trip, 'a', 'time-2m', true);
  assert.equal(isRestorableAlert(valid, trip), true);
  assert.equal(isRestorableAlert({ ...valid, operatorPairingCode: 'old' }, trip), false);
  assert.equal(isRestorableAlert({ ...valid, selectedStopId: 'gone' }, trip), false);
});