import assert from 'node:assert/strict';
import test from 'node:test';
import type { PassengerRealtimeSubscription } from '@workspace/api-client-react';
import {
  buildRealtimeSubscriptionInput,
  canSubscribeToActivePairedRun,
  findRealtimeSubscription,
  type RealtimeAlertIdentity,
  type RealtimeTransferOption,
} from './realtime-alerts-contract.ts';

const identity: RealtimeAlertIdentity = {
  passengerCode: '4821',
  deviceId: 'phone-installation',
  runKey: '2026-08-01|2|10|24|run-7',
  pickupStopId: 'pickup-12',
};

const transfer: RealtimeTransferOption = {
  runKey: 'onward-search-key',
  onwardRunKey: 'onward-exact-run-key',
  incomingSharedStopId: 'shared-stop-8',
  areaId: 14,
  minimumBufferMinutes: 20,
  bufferMinutes: 26,
  sharedStop: { id: 'shared-stop-8', label: 'Main Street', areaId: 14 },
  origin: { id: 14, name: 'Monsey' },
  destination: { id: 21, name: 'New Square' },
  connectionStatus: 'tight',
};

function subscription(overrides: Partial<PassengerRealtimeSubscription> = {}): PassengerRealtimeSubscription {
  return {
    id: 'subscription-id',
    flow: 'transfer-risk',
    deviceId: identity.deviceId,
    officialRunKey: identity.runKey,
    selectedStopId: transfer.incomingSharedStopId,
    onwardRunKey: transfer.onwardRunKey,
    transferAreaId: transfer.areaId,
    minimumBufferMinutes: transfer.minimumBufferMinutes,
    active: true,
    lastConnectionStatus: 'tight',
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

test('only a valid passenger code, installation, and selected paired run are eligible', () => {
  assert.equal(canSubscribeToActivePairedRun(identity), true);
  assert.equal(canSubscribeToActivePairedRun({ ...identity, passengerCode: '48A1' }), false);
  assert.equal(canSubscribeToActivePairedRun({ ...identity, deviceId: ' ' }), false);
  assert.equal(canSubscribeToActivePairedRun({ ...identity, runKey: '' }), false);
});

test('each alert input carries only its appropriate exact run and stop fields', () => {
  assert.deepEqual(buildRealtimeSubscriptionInput(identity, 'disruption', 'expo-token', false), {
    flow: 'disruption',
    passengerCode: '4821',
    deviceId: 'phone-installation',
    expoPushToken: 'expo-token',
    runKey: identity.runKey,
    soundEnabled: false,
  });
  assert.equal(
    buildRealtimeSubscriptionInput(identity, 'approaching-pickup', 'expo-token', true).selectedStopId,
    'pickup-12',
  );
  assert.deepEqual(
    buildRealtimeSubscriptionInput(identity, 'transfer-risk', 'expo-token', true, transfer),
    {
      flow: 'transfer-risk',
      passengerCode: '4821',
      deviceId: 'phone-installation',
      expoPushToken: 'expo-token',
      runKey: identity.runKey,
      soundEnabled: true,
      selectedStopId: 'shared-stop-8',
      onwardRunKey: 'onward-exact-run-key',
      transferAreaId: 14,
      minimumBufferMinutes: 20,
    },
  );
});

test('pickup and transfer-risk opt-ins require explicit valid choices', () => {
  assert.throws(
    () => buildRealtimeSubscriptionInput({ ...identity, pickupStopId: undefined }, 'approaching-pickup', 'token', true),
    /verified pickup stop/,
  );
  assert.throws(
    () => buildRealtimeSubscriptionInput(identity, 'transfer-risk', 'token', true),
    /Select a valid published transfer/,
  );
  assert.throws(
    () => buildRealtimeSubscriptionInput(identity, 'transfer-risk', 'token', true, {
      ...transfer,
      minimumBufferMinutes: 4,
    }),
    /Select a valid published transfer/,
  );
  assert.throws(
    () => buildRealtimeSubscriptionInput(identity, 'disruption', '', true),
    /push notification token/,
  );
});

test('restoration matches the exact active run, independent flow, pickup or selected connection', () => {
  const saved = subscription();
  assert.equal(findRealtimeSubscription([saved], identity.runKey, 'transfer-risk', undefined, transfer), saved);
  assert.equal(findRealtimeSubscription([saved], 'another-run', 'transfer-risk', undefined, transfer), undefined);
  assert.equal(findRealtimeSubscription([saved], identity.runKey, 'approaching-pickup', 'pickup-12'), undefined);
  assert.equal(findRealtimeSubscription([saved], identity.runKey, 'transfer-risk', undefined, {
    ...transfer,
    onwardRunKey: 'different-onward-run',
  }), undefined);
  assert.equal(findRealtimeSubscription([subscription({ active: false })], identity.runKey, 'transfer-risk', undefined, transfer), undefined);
});