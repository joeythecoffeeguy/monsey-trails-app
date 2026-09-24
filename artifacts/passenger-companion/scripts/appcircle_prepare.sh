#!/usr/bin/env bash
# Run as an Appcircle Custom Script after Install Node, before Android Build.
set -euo pipefail

: "${AC_REPOSITORY_DIR:?Appcircle must clone the repository first}"
: "${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:?Set the production Clerk publishable key in Appcircle Environment Variables}"
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-coach-passenger-display.replit.app}"
export CI=1

cd "$AC_REPOSITORY_DIR"
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install --frozen-lockfile

cd artifacts/passenger-companion
pnpm exec expo prebuild --platform android --no-install
python3 scripts/android_release.py prepare-unsigned