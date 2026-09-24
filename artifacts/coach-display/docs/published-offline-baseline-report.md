# Published passenger offline baseline

Captured 2026-09-23 from the public deployment
`https://coach-passenger-display.replit.app`.

## Command

```sh
cd artifacts/coach-display
node e2e/published-offline-baseline.mjs
```

This used a clean shell Playwright browser context with no route interception
or fixture server. The journey was opened through the live schedule (first
available verified run), which produced this exact URL:

```text
https://coach-passenger-display.replit.app/passengers?date=2026-09-23&line=1&origin=2&destination=5&run=2026-09-23%7C1%7C2%7C5%7C62251&departure=08%3A30%3A00
```

Verified online: published arrival `9:35 AM`, published stop times `8:30 AM`
and `9:35 AM`, and both endpoint stops (`Viola Road & Union Road` and
`5th Avenue & 23rd Street`). The journey was saved automatically.

Verified offline after `context.setOffline(true)` and reload: saved timestamp,
saved endpoint stops/times, offline map state, no live-tracking claim, and
reopening a distinct query variant for the same exact run. Offline negative
checks covered `/drivers/`, `/admin/`, `/sign-in/`, `/bus-display/`, and the
public journey API fetch. Reconnect and read-only reload restored the published
journey.

## Deployed fingerprint

Source: direct no-cache fetch of the public `/sw.js` and registered
CacheStorage, captured at `2026-09-23T12:09:23Z` response time.

```text
worker SHA-256: 39940d22b7479f13a5782c960c2db71a01deec0a565b544213b39c02ca1acf68
cache version: monsey-passenger-shell-v3
sw Last-Modified: Wed, 23 Sep 2026 06:15:49 GMT
sw Content-Type: text/javascript; charset=utf-8
registration scope: https://coach-passenger-display.replit.app/
```

Cached shell and assets:

```text
/passengers
/monsey-trails-logo.png
/manifest.json
/favicon.svg
/assets/index-BB0gI6Cg.css
/assets/index-gEBnTCSR.js
```

The public fingerprint is the v3 deployment baseline. It does **not** contain
the newer hashed-cache/atomic-install build from the current branch HEAD
(`3fe5829`); that task remains pending publication. The targeted local
production harness and its update/failure checks are separate evidence and
must not be interpreted as proof that the fix is live.

## Release dependency

The user republished before this check, but the no-cache worker fingerprint
still identifies the old release. This task runs in an isolated workspace;
its changes must be applied to the main project before publishing can include
them. The new worker's live rollout therefore remains unverified until after
that merge and a subsequent publish. Do not treat this baseline pass as
release acceptance for the new worker.

The retained baseline script intentionally asserts this observed release and
dated run; it is an evidence reproduction script, not a future-release test.
Use the production fixture contract for repeatable regression coverage, and
select a current published run for the post-merge live check.

Evidence:

- `artifacts/coach-display/e2e/published-online.png`
- `artifacts/coach-display/e2e/published-offline.png`
- `artifacts/coach-display/e2e/published-fingerprint.json`