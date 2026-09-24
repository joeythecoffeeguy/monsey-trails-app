/* Paste into DevTools as a Snippet, never import into the application.
 * See ../docs/driver-auth-regression.md. No credentials or provider objects
 * are returned; only fixed enums, booleans, and HTTP status codes.
 */
(() => {
  'use strict';
  let authorizedOrigin = null;
  let base = '';
  const stages = new Set([
    'signed-out', 'username', 'password-retry', 'challenge',
    'challenge-reload', 'challenge-return', 'verified', 'onboarded', 'onboarded-reload',
  ]);
  const statuses = new Set([
    'needs_identifier', 'needs_first_factor', 'needs_second_factor',
    'needs_client_trust', 'needs_new_password', 'complete',
  ]);
  const codes = new Set([
    'AUTH_REQUIRED', 'DRIVER_ACCESS_REQUIRED', 'DRIVER_USERNAME_REQUIRED',
    'DRIVER_ACCESS_UNAVAILABLE', 'UNTRUSTED_ORIGIN',
  ]);
  const paths = new Set([
    '/sign-in', '/sign-in/', '/sign-in/client-trust', '/sign-in/factor-two',
    '/sign-in/reset-password', '/drivers',
  ]);

  function development() {
    return window.location.protocol === 'https:'
      && window.location.hostname.endsWith('.replit.dev')
      && window.location.origin === authorizedOrigin
      && window.Clerk?.loaded === true
      && typeof window.Clerk.publishableKey === 'string'
      && window.Clerk.publishableKey.startsWith('pk_test_');
  }

  function authorize({ expectedOrigin, disposableAccountApproved, basePath = '' } = {}) {
    authorizedOrigin = null;
    if (disposableAccountApproved !== true || expectedOrigin !== window.location.origin
      || !/^https:\/\/[a-z0-9.-]+\.replit\.dev$/.test(expectedOrigin ?? '')
      || !/^(\/[a-zA-Z0-9_-]+)*$/.test(basePath)) {
      return { ready: false, reason: 'DEVELOPMENT_APPROVAL_REQUIRED' };
    }
    authorizedOrigin = expectedOrigin;
    base = basePath;
    if (!development()) {
      authorizedOrigin = null;
      return { ready: false, reason: 'DEVELOPMENT_CLERK_REQUIRED' };
    }
    return { ready: true };
  }

  async function checkpoint(stage) {
    if (!stages.has(stage)) return { pass: false, reason: 'UNKNOWN_CHECKPOINT' };
    if (!development()) return { pass: false, reason: 'DEVELOPMENT_APPROVAL_REQUIRED' };
    try {
      const clerk = window.Clerk;
      const rawStatus = clerk.client?.signIn?.status;
      const status = statuses.has(rawStatus) ? rawStatus : 'none-or-unrecognized';
      const relativePath = window.location.pathname.slice(base.length);
      const path = window.location.pathname.startsWith(`${base}/`) && paths.has(relativePath)
        ? relativePath : 'other';
      const active = clerk.session?.status === 'active';
      const pendingTask = Boolean(clerk.session?.currentTask);
      // Use the same cookie authentication as the actual driver-profile caller.
      // Never fetch, print, copy, or persist a JWT or provider resource.
      const response = await window.fetch(`${base}/api/driver/profile`, {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => null);
      const apiCode = codes.has(data?.code) ? data.code : 'none-or-unrecognized';
      const profile = data?.profile;
      const profileState = profile === null ? 'missing'
        : profile && ['username', 'unitNumber', 'phoneNumber'].every(
          (key) => typeof profile[key] === 'string' && profile[key].length > 0,
        ) ? 'present' : 'invalid';
      const denied = response.status === 401 && apiCode === 'AUTH_REQUIRED';
      const noSession = !clerk.session && !clerk.user;
      let pass = false;
      if (stage === 'signed-out') pass = noSession && denied;
      if (stage === 'username' || stage === 'password-retry') {
        pass = noSession && denied && status === 'needs_first_factor'
          && (path === '/sign-in' || path === '/sign-in/');
      }
      if (stage.startsWith('challenge')) {
        pass = noSession && denied && status === 'needs_client_trust'
          && path === '/sign-in/client-trust';
      }
      if (stage === 'verified') {
        pass = active && !pendingTask && path === '/drivers'
          && response.status === 200 && profileState === 'missing';
      }
      if (stage === 'onboarded' || stage === 'onboarded-reload') {
        pass = active && !pendingTask && path === '/drivers'
          && response.status === 200 && profileState === 'present'
          && profile.username === clerk.user?.username;
      }
      return {
        stage, pass, status, path, activeSession: active, pendingTask,
        apiStatus: response.status, apiCode, profileState,
      };
    } catch {
      // Error messages/stacks can embed identifiers, URLs, or provider payloads.
      return { stage, pass: false, reason: 'PROBE_FAILED' };
    }
  }

  window.driverAuthRegression = Object.freeze({ authorize, checkpoint });
})();