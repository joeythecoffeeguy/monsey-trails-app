import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionBoundRequest } from './session-bound-request';

test('account requests use the initiating session token', async () => {
  let identity = 'passenger-a:session-a';
  const request = await sessionBoundRequest(identity, () => identity, async () => 'token-a');
  assert.deepEqual(request, { headers: { Authorization: 'Bearer token-a' } });

  identity = 'passenger-b:session-b';
  await assert.rejects(
    sessionBoundRequest('passenger-a:session-a', () => identity, async () => 'token-b'),
    /account changed/,
  );
});

test('an account switch while retrieving a token cancels the request', async () => {
  let identity = 'passenger-a:session-a';
  let deliverToken!: (token: string) => void;
  const request = sessionBoundRequest(
    identity,
    () => identity,
    () => new Promise<string>(resolve => { deliverToken = resolve; }),
  );
  identity = 'passenger-b:session-b';
  deliverToken('token-b');
  await assert.rejects(request, /account changed/);
});