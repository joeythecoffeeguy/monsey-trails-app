import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makePendingAlertCancellation,
  parsePendingAlertCancellation,
  retryPendingAlertCancellation,
} from './alert-cancellation.ts';

test('a cancellation tombstone survives restart with the identity needed for retry', () => {
  const cancellation = makePendingAlertCancellation('1234', 'device-1', true);
  assert.deepEqual(
    parsePendingAlertCancellation(JSON.stringify(cancellation)),
    cancellation,
  );
});

test('invalid cancellation tombstones are rejected', () => {
  assert.equal(parsePendingAlertCancellation(null), null);
  assert.equal(parsePendingAlertCancellation('{broken'), null);
  assert.equal(parsePendingAlertCancellation(JSON.stringify({
    version: 1,
    passengerCode: 'coach-number',
    deviceId: 'device-1',
    leaveSession: true,
  })), null);
});

test('offline cancellation retains its tombstone and clears it only after a retry succeeds', async () => {
  const cancellation = makePendingAlertCancellation('1234', 'device-1', true);
  let clearCount = 0;
  const offline = await retryPendingAlertCancellation(
    cancellation,
    async () => undefined,
    async () => { throw new Error('offline'); },
    async () => { clearCount += 1; },
  );
  assert.equal(offline, false);
  assert.equal(clearCount, 0);

  const retried = await retryPendingAlertCancellation(
    cancellation,
    async () => undefined,
    async (value) => { assert.deepEqual(value, cancellation); },
    async () => { clearCount += 1; },
  );
  assert.equal(retried, true);
  assert.equal(clearCount, 1);
});

test('toggle-off and leave cancellation wait for an already-started registration', async () => {
  for (const leaveSession of [false, true]) {
    const cancellation = makePendingAlertCancellation('1234', 'device-1', leaveSession);
    let releaseRegistration!: () => void;
    const registrationSettled = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    let deleteCalled = false;
    const cancelling = retryPendingAlertCancellation(
      cancellation,
      () => registrationSettled,
      async () => { deleteCalled = true; },
      async () => undefined,
    );

    await Promise.resolve();
    assert.equal(deleteCalled, false);
    releaseRegistration();
    assert.equal(await cancelling, true);
    assert.equal(deleteCalled, true);
  }
});