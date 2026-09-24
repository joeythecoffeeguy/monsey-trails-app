# iPhone Live Activities

The passenger app includes an opt-in Lock Screen and Dynamic Island activity for an exact published run, pickup, and drop-off. It is a native iOS feature: **Expo Go and the web preview cannot show it**. A signed iPhone build is required. Phones without a Dynamic Island still show the Lock Screen activity.

## Apple setup

1. Enroll the app owner in the Apple Developer Program. The iOS bundle identifier is `app.replit.monseytrailspassenger`.
2. Enable the Push Notifications capability for that app identifier, and create an APNs authentication key with Live Activity push support. Keep the downloaded `.p8` file private. The `expo-widgets` config plugin enables Live Activities and their push entitlements in the native build.
3. Add `APNS_TEAM_ID`, `APNS_KEY_ID`, and `APNS_PRIVATE_KEY` as **Replit Secrets**, never in the repository. Paste the full `.p8` PEM text for the private key; escaped newlines also work. Do not use an Expo push token: ActivityKit issues a separate per-activity APNs token.
4. Configure `APNS_ENVIRONMENT=production` for an App Store or internally distributed/ad hoc iOS build, or `sandbox` for a development-signed iOS build. The APNs environment must match the build's `aps-environment` entitlement. Restart the API service after configuring it; `/api/passenger/live-activities/availability` should report `{"available":true}`.
5. Use Replit's Publish flow to build and distribute the signed iOS app through App Store Connect and TestFlight (requires the app owner's Apple signing access). Install that build on an iPhone and open the passenger app. Expo Go's QR preview is not the signed app.

Choose a published run and exact pickup/drop-off, wait for a matched running coach, then tap **Start Live Activity**. Once ActivityKit issues an APNs token and registration succeeds, server-side GPS updates can reach the Lock Screen while the app is closed. The activity switches from pickup to onboard only when the coach has completed the selected pickup, and ends at the selected drop-off or trip end. If GPS is more than 90 seconds old, it stops presenting the ETA as live.

Native delivery and Dynamic Island presentation must be checked on a signed physical iPhone; a successful web preview or TypeScript build cannot verify APNs or ActivityKit.