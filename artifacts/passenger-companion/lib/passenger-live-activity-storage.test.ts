import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePassengerLiveActivityRecords,
  passengerLiveActivityMatchesIdentity,
  removePassengerLiveActivityRecord,
  upsertPassengerLiveActivityRecord,
  type PassengerLiveActivityRecord,
} from './passenger-live-activity-storage.ts';

const record: PassengerLiveActivityRecord = {
  clientActivityId: 'activity-1',
  serverId: 'server-1',
  runKey: '2026-09-24|1|2|5|run-1',
  passengerCode: '1234',
  pickupStopId: 'pickup-1',
  dropoffStopId: 'dropoff-1',
};

test('activity recovery identity is scoped to run, passenger code, and both exact stops', () => {
  assert.equal(passengerLiveActivityMatchesIdentity(record, record), true);
  assert.equal(passengerLiveActivityMatchesIdentity(record, { ...record, runKey: 'other-run' }), false);
  assert.equal(passengerLiveActivityMatchesIdentity(record, { ...record, passengerCode: '9876' }), false);
  assert.equal(passengerLiveActivityMatchesIdentity(record, { ...record, pickupStopId: 'other-pickup' }), false);
  assert.equal(passengerLiveActivityMatchesIdentity(record, { ...record, dropoffStopId: 'other-dropoff' }), false);
});

test('mapping parsing ignores malformed entries and safely handles invalid storage', () => {
  assert.deepEqual(parsePassengerLiveActivityRecords('{'), []);
  assert.deepEqual(parsePassengerLiveActivityRecords(JSON.stringify([record, { clientActivityId: '' }])), [record]);
});

test('mapping upsert and removal target only the specified native activity identifier', () => {
  const another = { ...record, clientActivityId: 'activity-2', runKey: 'other-run' };
  assert.deepEqual(upsertPassengerLiveActivityRecord([record], another), [record, another]);
  assert.deepEqual(removePassengerLiveActivityRecord([record, another], record.clientActivityId), [another]);
});