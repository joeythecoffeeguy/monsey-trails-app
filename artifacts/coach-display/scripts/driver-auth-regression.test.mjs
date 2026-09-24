import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// These are helper unit tests, NOT evidence of real Clerk authentication.
const source = readFileSync(new URL('./driver-auth-regression.js', import.meta.url), 'utf8');
const origin = 'https://disposable-preview.replit.dev';
function fixture() {
  const requests = [];
  let body = { code: 'AUTH_REQUIRED' };
  let status = 401;
  const window = {
    location: new URL(`${origin}/sign-in`),
    Clerk: {
      loaded: true,
      publishableKey: 'pk_test_synthetic',
      client: { signIn: { status: 'needs_first_factor' } },
      session: null,
      user: null,
    },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { status, json: async () => body };
    },
  };
  const context = vm.createContext({ window, AbortSignal });
  vm.runInContext(source, context);
  return {
    window, requests,
    api: window.driverAuthRegression,
    authorize: (overrides = {}) => window.driverAuthRegression.authorize({
      expectedOrigin: origin, disposableAccountApproved: true, ...overrides,
    }),
    respond: (nextStatus, nextBody) => { status = nextStatus; body = nextBody; },
    reinstall: () => vm.runInContext(source, context),
  };
}

test('no network before explicit Development authorization; invalid stages rejected', async () => {
  const f = fixture();
  assert.equal((await f.api.checkpoint('signed-out')).pass, false);
  assert.equal(f.authorize({ disposableAccountApproved: false }).ready, false);
  assert.equal(f.authorize({ expectedOrigin: 'https://other.replit.dev' }).ready, false);
  assert.equal(f.authorize({ basePath: '//outside.example' }).ready, false);
  assert.equal(f.authorize().ready, true);
  assert.equal((await f.api.checkpoint('sensitive-arbitrary-input')).reason, 'UNKNOWN_CHECKPOINT');
  assert.equal(f.requests.length, 0);
});

test('rejects live keys, non-preview hosts, insecure origins, and unloaded Clerk', async () => {
  for (const change of [
    (w) => { w.Clerk.publishableKey = 'pk_live_synthetic'; },
    (w) => { w.location = new URL('https://published.example/sign-in'); },
    (w) => { w.location = new URL('https://preview.replit.dev.evil.example/sign-in'); },
    (w) => { w.location = new URL('http://disposable-preview.replit.dev/sign-in'); },
    (w) => { w.Clerk.loaded = false; },
    (w) => { w.Clerk = undefined; },
  ]) {
    const f = fixture();
    change(f.window);
    assert.equal(f.authorize({ expectedOrigin: f.window.location.origin }).ready, false);
    assert.equal((await f.api.checkpoint('signed-out')).pass, false);
    assert.equal(f.requests.length, 0);
  }
});

test('revalidates environment on every checkpoint and resets approval on reload', async () => {
  const f = fixture();
  f.authorize();
  f.window.Clerk.publishableKey = 'pk_live_synthetic';
  assert.equal((await f.api.checkpoint('signed-out')).pass, false);
  assert.equal(f.requests.length, 0);
  f.window.Clerk.publishableKey = 'pk_test_synthetic';
  f.reinstall();
  assert.equal((await f.window.driverAuthRegression.checkpoint('signed-out')).pass, false);
});

test('username/password retry require pending first factor and real API 401', async () => {
  const f = fixture();
  f.authorize();
  for (const stage of ['signed-out', 'username', 'password-retry']) {
    assert.equal((await f.api.checkpoint(stage)).pass, true);
  }
  for (const [status, body] of [
    [200, { profile: null }],
    [403, { code: 'UNTRUSTED_ORIGIN' }],
    [503, { code: 'DRIVER_ACCESS_UNAVAILABLE' }],
    [401, { code: 'OTHER' }],
  ]) {
    f.respond(status, body);
    assert.equal((await f.api.checkpoint('password-retry')).pass, false);
  }
});

test('Device Trust needs both the real resource status and continuation path', async () => {
  const f = fixture();
  f.authorize();
  f.window.location.pathname = '/sign-in/client-trust';
  f.window.Clerk.client.signIn.status = 'needs_client_trust';
  for (const stage of ['challenge', 'challenge-reload', 'challenge-return']) {
    assert.equal((await f.api.checkpoint(stage)).pass, true);
  }
  f.window.location.pathname = '/sign-in';
  assert.equal((await f.api.checkpoint('challenge')).pass, false);
  f.window.location.pathname = '/sign-in/client-trust';
  for (const status of ['needs_identifier', 'needs_first_factor', 'needs_second_factor', 'complete']) {
    f.window.Clerk.client.signIn.status = status;
    assert.equal((await f.api.checkpoint('challenge')).pass, false);
  }
  f.window.Clerk.client.signIn.status = 'needs_client_trust';
  f.window.Clerk.session = { status: 'active' };
  assert.equal((await f.api.checkpoint('challenge')).pass, false);
  f.window.Clerk.session = null;
  f.respond(200, { profile: null });
  assert.equal((await f.api.checkpoint('challenge')).pass, false);
});

test('verification and onboarding require active session, correct gate, valid matching profile', async () => {
  const f = fixture();
  f.authorize();
  f.window.location.pathname = '/drivers';
  f.window.Clerk.session = { status: 'active', currentTask: null };
  f.window.Clerk.user = { username: 'synthetic-assigned' };
  f.respond(200, { profile: null });
  assert.equal((await f.api.checkpoint('verified')).pass, true);
  assert.equal((await f.api.checkpoint('onboarded')).pass, false);
  f.window.Clerk.session.currentTask = { key: 'synthetic-task' };
  assert.equal((await f.api.checkpoint('verified')).pass, false);
  f.window.Clerk.session.currentTask = null;
  for (const profile of [{}, { username: 'synthetic-assigned' }, {
    username: 'wrong-account', unitNumber: 'synthetic', phoneNumber: '+12025550123',
  }]) {
    f.respond(200, { profile });
    assert.equal((await f.api.checkpoint('onboarded')).pass, false);
  }
  f.respond(200, { profile: {
    username: 'synthetic-assigned', unitNumber: 'synthetic', phoneNumber: '+12025550123',
  } });
  assert.equal((await f.api.checkpoint('onboarded')).pass, true);
  assert.equal((await f.api.checkpoint('onboarded-reload')).pass, true);
  assert.equal((await f.api.checkpoint('verified')).pass, false);
  f.window.Clerk.session.status = 'pending';
  assert.equal((await f.api.checkpoint('onboarded')).pass, false);
});

test('only same-origin read request, no token requests, respects base prefix', async () => {
  const f = fixture();
  f.authorize({ basePath: '/coach' });
  f.window.location.pathname = '/coach/sign-in';
  f.window.Clerk.session = { getToken() { throw Error('must never read tokens'); } };
  const result = await f.api.checkpoint('username');
  assert.equal(result.pass, false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/coach/api/driver/profile');
  const init = f.requests[0].init;
  assert.equal(init.method, undefined); // GET only.
  assert.equal(init.body, undefined);
  assert.equal(init.headers, undefined);
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  f.window.Clerk.session = null;
  assert.equal((await f.api.checkpoint('username')).pass, true);
});

test('diagnostics omit provider bodies, arbitrary codes/statuses/paths, and error details', async () => {
  const f = fixture();
  const secretMarker = 'synthetic-private-canary';
  f.authorize();
  f.window.location.pathname = `/sign-in/${secretMarker}`;
  f.window.location.search = `?token=${secretMarker}`;
  f.window.Clerk.client.signIn = { status: secretMarker, id: secretMarker, identifier: secretMarker };
  f.respond(401, { code: secretMarker, error: secretMarker, jwt: secretMarker });
  const result = await f.api.checkpoint('challenge');
  assert.equal(result.pass, false);
  assert.equal(result.path, 'other');
  assert.equal(result.status, 'none-or-unrecognized');
  assert.equal(result.apiCode, 'none-or-unrecognized');
  assert.equal(JSON.stringify(result).includes(secretMarker), false);
  f.window.fetch = async () => { throw new Error(secretMarker); };
  const failure = await f.api.checkpoint('challenge');
  assert.equal(failure.reason, 'PROBE_FAILED');
  assert.equal(JSON.stringify(failure).includes(secretMarker), false);
});

test('malformed JSON is not a successful authorized profile response', async () => {
  const f = fixture();
  f.authorize();
  f.window.location.pathname = '/drivers';
  f.window.Clerk.session = { status: 'active' };
  f.window.fetch = async () => ({ status: 200, json: async () => { throw Error('bad-json'); } });
  assert.equal((await f.api.checkpoint('verified')).pass, false);
});