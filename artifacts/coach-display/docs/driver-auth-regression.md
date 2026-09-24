# Real Development driver sign-in regression

This is a **manual, real-provider release check**, with a read-only browser
helper. It is not an unattended CI login and is not a replacement for the focused
component tests. Those tests mock `SignIn`; a passing mock cannot establish that
Clerk resumed the real Device Trust screen.

Run after changing the custom password flow, Clerk version, continuation routes,
router/provider wiring, or driver authorization/onboarding. Use a fresh browser
context for each run. Budget one incorrect-password attempt and one valid login;
do not loop through passwords, account identifiers, or verification codes.

## 1. Mandatory authorization and isolation

Do not start credential testing until **all** items are satisfied:

- The owner explicitly authorizes an exact **disposable Development driver
  account**, its assigned username and real verification inbox, one incorrect
  password attempt, profile creation, and deletion of that account/profile.
  Existing secrets or a username seen in logs are **not** authorization. Keep
  identifiers out of committed reports. Never invent email aliases, create an
  account against an arbitrary inbox, or reuse a real driver/admin account.
- An authorized administrator provisions the disposable account through the
  existing Development administrator flow. It must have an assigned username,
  password, approved real email for receiving the actual challenge, and protected
  driver entitlement (`driverAccess: true` or `role: "driver"`). It must not have
  administrator access, an existing driver profile, or any owned coach/trip.
  Do not change provider settings or mark an email verified to make a test pass.
- Confirm the workspace Development preview origin, the frontend's test-key
  environment, the matching API Clerk **Development** instance, and the
  **Development** database. The helper checks the browser's test-key prefix and
  exact `.replit.dev` origin, but cannot attest to the server/database
  environment. The authorized operator must confirm those separately. Do not
  print keys or database connection strings. Never use a published/Production
  URL, even if a Development check cannot reproduce the issue.
- Arrange cleanup ownership **before** starting: an administrator who can revoke
  sessions/delete the exact disposable Clerk user, and a database operator who
  can delete only its Development profile row. Keep the exact subject/account
  mapping in a temporary private operator note, not source control or a report.
  If these permissions are unavailable, the run is **BLOCKED**.
- Open a brand-new private browser context with no imported cookies/storage,
  extensions, saved login, administrator session, or granted location
  permission. Deny location prompts. Do not connect, pair, or select any coach,
  including a “test” bus number; stop at the unpaired console.

### Credential and code input

The operator types the password and **fresh code actually received** directly
into the app/provider UI. Never put either in chat, shell arguments, source files,
DevTools expressions, Playwright steps, screenshots, recordings, or reports.
For an agent-assisted run, collect approved inputs only through the workspace
Secrets flow after checking existence without reading values; do not reuse a
stale `DRIVER_TEST_VERIFICATION_CODE` merely because it exists. Remove temporary
test secrets using the Secrets UI when finished.

Disable browser recordings, screenshots, traces, HAR export, verbose network
logging, and console/network “Preserve log” **before** input. Do not enable
Playwright tracing or automatic failure screenshots. The usual testing-agent
programmatic Clerk login, token injection, testing tokens, claim overrides,
testing OTPs, and forced verification are forbidden here: they bypass exactly
the behavior this procedure is intended to test.

## 2. Install the read-only checkpoint helper

Start the existing `artifacts/coach-display: web` and
`artifacts/api-server: API Server` Development workflows if stopped. Confirm both
are serving normally; do not create replacement services or restart a deployed
service for this check.

Open `<approved-development-origin>/sign-in` in the isolated context. Wait for
Clerk to load. In DevTools Sources → Snippets, paste and run the contents of
`scripts/driver-auth-regression.js` (relative to this artifact). It is intentionally
not imported into the shipped application.

Authorize it using the **exact approved preview origin**, with no trailing slash:

```js
driverAuthRegression.authorize({
  expectedOrigin: 'https://<approved-preview-host>.replit.dev',
  disposableAccountApproved: true,
  basePath: '',
})
```

The current coach app is mounted at `/`, so `basePath` is empty. If it is moved,
use its registered base path without a trailing slash. The returned value must
be `{ ready: true }`. This declaration records operator intent in memory; it is
not a substitute for owner approval.

Run checkpoints as follows and record only their returned, sanitized result:

```js
await driverAuthRegression.checkpoint('signed-out')
```

The helper only issues `GET /api/driver/profile` with the same cookies as the app.
It does not sign in/out, mutate profiles, pair coaches, change provider settings,
read tokens, or automate/solve challenges. It returns fixed status/path/code
enums, booleans, and HTTP status numbers, never identifiers or response bodies.
Redirects and network errors fail closed. A 403 origin error or a 503 outage is
**not** proof of unauthenticated API denial.

**After every full navigation/reload**, rerun the snippet and `authorize` call.
Its state is intentionally memory-only. There is no persisted credential,
session, or “passed” flag. Each checkpoint is a local assertion, not a full-suite
verdict; complete every row below and the cleanup checklist.

## 3. Required real-provider sequence

Record both the UI observation and helper result. A route or HTTP 200 alone is
not evidence that the real widget is displaying the right step.

| Step | Operator action and required UI observation | Helper checkpoint / expected result |
| --- | --- | --- |
| Baseline | `/sign-in` shows **Enter your username**, no password yet. No signed-in console. | `signed-out`: PASS, no session, API **401 / AUTH_REQUIRED** |
| Username recognition | Enter the exact approved assigned username; click **Continue**. **Enter your password** appears; username remains read-only. Do not replace it with an email to get past a failure. | `username`: PASS, `needs_first_factor`, API 401 |
| Password retry | Enter one deliberately incorrect password (not any real credential). Click **Sign in**. **Incorrect password. Please try again.** appears; password field stays usable, username unchanged. | `password-retry`: PASS, same first-factor state, API 401 |
| Correct password → real Device Trust | Enter the correct password in the UI. Wait for navigation. The **real Clerk widget** must show its new-device/security verification/code-entry flow, not a new identifier or password page. No driver console or profile form yet. | `challenge`: PASS, `needs_client_trust`, `/sign-in/client-trust`, no active session, API 401 |
| Challenge reload | Reload the current challenge URL **before entering a code**. Reinstall helper. The same pending verification UI must still be reachable; do not enter username/password again to manufacture success. | `challenge-reload`: PASS, same challenge status/path and API 401 |
| Challenge navigation | In that same context go to `/sign-in` using the address bar. The app must restore the pending flow at `/sign-in/client-trust` without returning to identifier entry. Reinstall helper. Use the widget's Back/alternate verification link if offered, then its normal return-to-code action; do not use **start over** or sign out. | `challenge-return`: PASS after returning to the real code-entry UI, API 401 |
| Actual verification | Request/resend only if necessary for the approved inbox, then enter the current real code directly in the widget. Finish its normal verification flow. Expect `/drivers` and **Driver Profile**, not username/password entry again. | `verified`: PASS, active session, no pending task, API **200**, `profileState: missing` |
| Real onboarding | Check the assigned username is displayed, not editable. Submit empty fields once: required messages appear and form stays open. Fill **Unit Number** with a unique disposable label (≤20 characters, not a bus number) and **Phone Number** with the approved synthetic test value, e.g. `+12025550123`. Click **Complete Profile** once. Confirm the actual profile save succeeds and the unpaired console appears. **Do not click Connect.** | `onboarded`: PASS, API 200, valid profile matching the provider username |
| Persistence | Reload `/drivers`; reinstall helper. Expect unpaired console, not onboarding/login again. No coach selected or pairing code created. | `onboarded-reload`: PASS, API 200, same profile; visually confirm unit/contact in account UI if shown |
| Sign out | Use the app's **Sign out** control. Return to `/sign-in`; reinstall helper. | `signed-out`: PASS, API 401; proceed immediately to cleanup below |

At the initial challenge, also confirm the write authorization boundary with this
**invalid-body** request in the same isolated browser. It cannot create a valid
profile (required unit and phone are absent). Run it only before verification,
never with an existing authenticated driver/admin session:

```js
await (async () => {
  try {
    const r = await fetch('/api/driver/profile', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const b = await r.json().catch(() => null);
    return { pass: r.status === 401 && b?.code === 'AUTH_REQUIRED',
      apiStatus: r.status };
  } catch { return { pass: false, reason: 'PROBE_FAILED' }; }
})()
```

Use the registered base prefix on this path if the app is moved. Expect **401**,
not 400/200: validation must not be reached before authentication. This is not
a coach-operation test; never send pairing or trip mutation requests.

### Stop conditions and verdicts

- **FAIL**: known approved username rejected, password retry resets identifier,
  real widget resets to identifier/password after a correct password, challenge
  lost on reload/return, authorized API response before verification, wrong
  post-verification gate, failed save/persistence, or unexpected coach activity.
  Do not keep trying credentials to “fix” it. Proceed to cleanup.
- **BLOCKED / NOT EXERCISED**: no authorized disposable identity/inbox/cleanup
  permissions; provider outage/rate limit; no Device Trust challenge naturally
  produced. A direct successful session, MFA, password reset, or account task is
  **not a Device Trust pass**. Record the allowlisted status and stop. Do not
  disable security, adjust provider configuration, bypass bot checks, ban/unban
  the account to induce a flow, or test Production instead.
- **PASS**: every required UI observation, helper checkpoint, pre-verification
  write denial, and cleanup item succeeds. Do not report the full check as passed
  if only username/password or mocked tests ran.

## 4. Cleanup — required on success, failure, interruption, or blocked runs

Treat this as a `finally` block. A closed browser is not server-side cleanup.

1. If the app can sign out, do so and confirm the signed-out checkpoint. If it
   cannot, stop browser interaction; the authorized administrator must revoke all
   sessions for **only the approved disposable Development account**.
2. The administrator deletes that exact disposable account in the matching Clerk
   Development instance. Do not delete by a username prefix, email suffix, or
   “all test users” query. If an approved existing disposable account cannot be
   deleted, do not start this procedure; obtain a deletable fixture first.
3. In the confirmed **Development** database, the database operator checks for
   unexpected coach ownership by the exact authorized Clerk subject. If any
   exists, report failure and use the app's safe release flow for that account;
   do not delete or alter other drivers' trips. No coach rows should be created.
4. Delete only the disposable profile by that exact subject, including on runs
   that failed after submission. Use a bound parameter, transaction, and row-count
   check (0 or 1); verify no row remains. Never paste identifiers into committed
   SQL, broad-delete profiles, reset the DB, or assume Clerk deletion cascades.
   The operator's parameterized SQL template is:

   ```sql
   -- $1 is the exact approved disposable subject, bound privately.
   SELECT count(*) FROM live_trips WHERE owner_subject = $1;
   DELETE FROM driver_profiles WHERE clerk_subject = $1;
   SELECT count(*) FROM driver_profiles WHERE clerk_subject = $1;
   ```

   Run the ownership check first; if nonzero, stop deletion until safe release
   is confirmed. Check the delete affects at most one row before committing.
5. Verify in Clerk that the disposable user/sessions are gone. Close all private
   tabs/context, delete the temporary private identifier note, remove temporary
   test secrets/codes, and clear local DevTools network/console buffers. Do not
   save cookies, storage state, traces, raw provider responses, or HARs.
6. If any cleanup fails, record **CLEANUP BLOCKED** (never PASS), notify the
   responsible administrator, and do not run again against new fixtures until
   the prior one is removed. Keep only the minimum private reference needed by
   that administrator until cleanup is confirmed.

## 5. Sanitized evidence record

Copy this template into a private run report. Commit only fully sanitized
results if needed. Do not append raw console logs or HTTP/provider bodies.

```text
Date / code revision / browser version:
Environment: Development preview + Development Clerk/API/DB confirmed [yes/no]
Owner approval and disposable fixture deletion approved [yes/no]
Isolated fresh context, no recording/token bypass [yes/no]
Username UI + checkpoint [PASS/FAIL/BLOCKED]
Incorrect password UI + checkpoint [PASS/FAIL/BLOCKED]
Real Device Trust UI + checkpoint [PASS/FAIL/NOT EXERCISED]
Challenge reload UI + checkpoint [PASS/FAIL/NOT EXERCISED]
Challenge navigation UI + checkpoint [PASS/FAIL/NOT EXERCISED]
Pre-verification GET + invalid PUT both 401 [yes/no/not exercised]
Real code completion and profile-missing gate [PASS/FAIL/NOT EXERCISED]
Onboarding validation/save + reload [PASS/FAIL/NOT EXERCISED]
Sign out / session revocation [done/blocked]
Disposable Clerk account + DB profile removed [done/blocked]
No coach paired, no credentials/PII/tokens saved [yes/no]
Overall [PASS/FAIL/BLOCKED/CLEANUP BLOCKED]
Sanitized checkpoint results:
```

For provider errors, record only a known error code such as
`form_identifier_not_found`, `form_identifier_invalid`,
`form_password_incorrect`, or `too_many_requests`; otherwise record `unrecognized`.
Never copy messages, stacks, request IDs, sign-in/session/user IDs, email hints,
query strings, credential payloads, or a complete provider resource.

## Offline checks (not real-provider evidence)

```sh
node --test artifacts/coach-display/scripts/driver-auth-regression.test.mjs
pnpm --filter @workspace/coach-display exec vitest run --config vitest.config.ts \
  src/components/driver-login-form.test.tsx \
  src/components/driver-onboarding.test.tsx
```

The first command checks helper safety/sanitization and assertion logic with
synthetic resources. The second covers application continuation routing and
onboarding controls with mocks. **Neither executes this manual procedure or
proves real Device Trust behavior.** No live account is created by either.
The helper checks also run as `pnpm --filter @workspace/coach-display run
test:auth-helper` and at the start of this artifact's standard `test` command.