import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDefinitivePassengerSessionExpiry,
  shouldPollPassengerSession,
} from './session-lifecycle.ts';

test('paired passengers keep polling before departure and while running', () => {
  assert.equal(shouldPollPassengerSession({ status: 'idle' }, '1234'), true);
  assert.equal(shouldPollPassengerSession({ status: 'ready' }, '1234'), true);
  assert.equal(shouldPollPassengerSession({ status: 'running' }, '1234'), true);
  assert.equal(shouldPollPassengerSession(null, '1234'), false);
  assert.equal(shouldPollPassengerSession({ status: 'ready' }, ''), false);
});

test('only a definitive API expiry clears a restored passenger session', () => {
  assert.equal(isDefinitivePassengerSessionExpiry({ status: 404 }), true);
  assert.equal(isDefinitivePassengerSessionExpiry({ status: 410 }), true);
  assert.equal(isDefinitivePassengerSessionExpiry({ status: 500 }), false);
  assert.equal(isDefinitivePassengerSessionExpiry(new Error('offline')), false);
});