# Production passenger offline contract — browser regression evidence

## Command

```sh
cd artifacts/coach-display
PORT=4179 BASE_PATH=/ NODE_ENV=production pnpm run build
node e2e/production-offline-contract.mjs
```

The test launches the installed shell Playwright Chromium executable from
`$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`, copies `dist/public` to a temporary
profile, and starts `production-fixture-server.mjs` on a random localhost
port. It does not use a managed workflow, database, deployment, or Vite
development server.

## Completed assertions

- Production build completed with `BASE_PATH=/`; the published topology is
  `/passengers`, not `/passengers/passengers`.
- Deterministic read-only journey loaded online for
  `2026-09-24|1|2|5|fixture-run`; Alpha Stop, Beta Stop, published times, and
  the journey were visible.
- Journey was saved to localStorage and the production service worker became
  active with a build-specific `monsey-passenger-shell-*` cache.
- `context.setOffline(true)` plus reload of the exact query URL displayed the
  saved timestamp, saved stops/times, offline map notice, and no live tracking
  control.
- A distinct query variant for the same run reopened offline from the saved
  journey.
- Offline `/drivers/` did not receive the passenger navigation fallback.
- Reconnecting and changing the fixture schedule produced the fresh
  `Fixture Destination Fresh` response.

Evidence: `e2e/production-online.png`, `e2e/production-offline.png`.

## Targeted update retest

The updated worker contract passes. The harness discovers the injected cache
name from the built worker, then mutates only a temporary copied dist:

- Adds `assets/production-update-marker-a1b2c3d4.js` to the copied shell.
- Changes the copied worker cache name by regex to
  `monsey-passenger-shell-622f596227ac8ded-update`.
- Verifies the marker executes online and after offline reload.
- Verifies only the new named cache remains and the old cache is removed.
- Deletes the marker asset, attempts a second worker update with a new
  `-failed` cache name, and verifies the old active cache remains usable
  offline; the failed cache is not retained.

The script also enumerates the initial allowlist and verifies it contains the
passenger shell, required static assets, and hashed CSS/JS only, with no API,
driver, admin, auth, or mounted-display paths. It explicitly checks offline
navigation controls for `/drivers/`, `/admin/`, `/sign-in/`, and
`/bus-display/`, plus an offline API fetch rejection.

Final result: `node e2e/production-offline-contract.mjs` passed and printed
`{"ok":true,...}`. Evidence additionally includes
`e2e/production-updated-offline.png`.

The worker activation can transiently report `activating` while the atomic
cache replacement completes; the durable harness polls for an activated
registration and a stable single-cache result before asserting.

Other build warnings were the existing unresolved sourcemap-location warnings
and the large JavaScript chunk warning. The browser harness changed only its
temporary build copy. The implementation fix makes caches install-only and
build-versioned and rejects incomplete precaches.

## Limits

This verifies production-built files in Chromium, not an actual published
deployment or Safari/iOS. Reconnect freshness was verified after reloading;
this report does not assert automatic refresh without navigation.