# Android internal-test release

This app lives at `artifacts/passenger-companion` in the pnpm workspace. Android
releases use **Expo EAS Build**, not Replit Expo Launch (which publishes iOS).
The `production` EAS profile produces an Android App Bundle (`.aab`) for
`com.monseytrails.passenger`. It never submits automatically.

## Before starting the build

1. In Expo, use an Expo account you control with access to the project in
   `app.json` (`extra.eas.projectId`). If that project belongs to an account
   you cannot administer, first create/transfer a project in an account you
   control and replace **only** `extra.eas.projectId` with the new project ID.
   Do not change `android.package`: it must match the existing Play Console app.
2. In that Expo project's **GitHub** settings, install the Expo GitHub App,
   connect `joeythecoffeeguy/monsey-trails-app`, and set **Base directory** to
   `artifacts/passenger-companion`. Grant the Expo account and GitHub user the
   permissions requested by Expo. GitHub-triggered builds require an initial
   successful Android build and configured Android credentials for this project.
3. In the project's **Environment variables**, add
   `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to the **production** environment.
   Obtain the publishable (client-side) key from the owner's Clerk configuration.
   If the production Clerk instance uses a proxy, also set
   `EXPO_PUBLIC_CLERK_PROXY_URL` to its full HTTPS proxy URL. Do not copy
   server-side Clerk secret keys into EAS or the app. `EXPO_PUBLIC_DOMAIN`
   is set to the verified published API host in `eas.json` (without `https://`);
   check it still serves `/api/healthz` before each release.
4. Set up Android **remote signing credentials** in the Expo project. If the
   existing Play app has a registered upload certificate, provide its matching
   upload keystore to Expo securely through the Expo credentials UI. Otherwise,
   have Expo generate and retain an upload key, and follow Play Console's
   upload-key registration instructions if the app already has a different key.
   Keep a secure backup of the upload key. Never put a keystore, passwords, or
   `credentials.json` in the GitHub repository.
5. Confirm the `android.versionCode` in `app.json` is **greater than every
   version code already uploaded** for this Play app. This release starts at 1;
   increment it in source before another build if Play has used that code.

## Build and verify

After the repo is linked and the first Android build/credentials setup is
complete, open the Expo project's **Builds** page, choose **Build from GitHub**,
select the `main` commit that includes this release, **Android**, the
`production` profile, and the base directory above. Wait until the build
status is **Finished**; an in-progress or failed build is not a release.
Download the `.aab` from the completed build's artifacts.

Check the downloaded file before uploading:

```sh
file path/to/application.aab
unzip -t path/to/application.aab
bundletool dump manifest --bundle=path/to/application.aab --xpath=/manifest/@package
bundletool dump manifest --bundle=path/to/application.aab --xpath=/manifest/@android:versionCode
keytool -printcert -jarfile path/to/application.aab
```

The package must be `com.monseytrails.passenger`, the version code must be
unused, and the signing certificate must match the upload certificate
registered for the Play app. Record the build ID, commit, version code, and
SHA-256 fingerprint for the release.

## Upload to the existing internal test

In Google Play Console, open the **existing** `com.monseytrails.passenger` app,
then **Testing → Internal testing → Releases**. Edit the draft release (or
create a new release in the existing internal-testing track), upload the
verified `.aab`, inspect Play's package/signature/version warnings, add release
notes, and save. Complete the review and roll out the release to internal
testers in Play Console. The build is **not submitted** or live just because
Expo finished; confirm the release status in Play Console before telling
testers it is available.

Official guides:
- https://docs.expo.dev/build/building-from-github/
- https://docs.expo.dev/build-reference/build-with-monorepos/
- https://docs.expo.dev/build-reference/android-builds/