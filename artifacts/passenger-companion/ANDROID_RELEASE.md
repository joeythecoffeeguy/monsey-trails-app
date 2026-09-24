# Android internal-test release

The Android bundle is built by the manual **Android internal-test bundle**
workflow in GitHub Actions, not by Replit Expo Launch or the existing Expo
project (which the owner cannot administer). The workflow uses pnpm at the
repository root, generates Android native files for
`artifacts/passenger-companion`, signs a store release, verifies it, and
uploads the `.aab` as a workflow artifact. It does **not** submit to Play.

## One-time owner setup in GitHub

In `joeythecoffeeguy/monsey-trails-app`, open **Settings → Secrets and
variables → Actions**. Set these repository **secrets**:

| Name | Value |
| --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Base64-encoded bytes of the Android upload keystore |
| `ANDROID_UPLOAD_STORE_PASSWORD` | Keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | Alias of the upload key inside the keystore |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Password for that key |

The keystore must match the **upload certificate already registered for the
existing Play Console app**. If the Play app has no registered upload
certificate yet, generate and retain an upload key through a trusted local
tool, then register its certificate as Play Console directs. If Play has a
different upload certificate, arrange a Play Console upload-key reset before
trying to upload a bundle signed with a new key. Keep a secure backup of the
keystore and passwords. Never commit them, paste them into chat, or store them
in GitHub variables. The workflow decodes the keystore into the temporary
runner directory; the key and passwords are not included in build artifacts.

Set the repository **variable** `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to the
production Clerk *publishable* key used by this app. If production Clerk uses
a proxy, also set the variable `EXPO_PUBLIC_CLERK_PROXY_URL` to its full
HTTPS proxy URL. Never put the Clerk **secret** key in the mobile build.
The workflow embeds `EXPO_PUBLIC_DOMAIN=coach-passenger-display.replit.app`,
the verified public API host, into the native bundle. If the published API
host changes, update the workflow before building.

## Build and verify

1. Confirm the `android.versionCode` in `app.json` is **higher** than every
   version code previously uploaded to this Play app. It is currently `1`.
   Keep `android.package` as `com.monseytrails.passenger`. Commit and push
   any version-code change before starting the build.
2. Open the repository's **Actions → Android internal-test bundle → Run
   workflow**, select `main`, and start it. It fails clearly if required
   credentials or the Clerk publishable key are missing.
3. Wait for all steps, including **Verify package, version and signature**,
   to pass. Download the `monsey-trails-passenger-internal-aab` artifact from
   the successful run and extract the `.aab` from its zip file. The workflow
   checks that the bundle is a valid zip, has the expected package and version
   metadata, is signed with the supplied upload keystore, and prints the
   bundle SHA-256 and signing certificate SHA-256. Compare the certificate
   SHA-256 to the upload certificate shown in Play Console.

The bundle's GitHub Actions artifact expires after 14 days. Retain a copy of
the `.aab` and record the Git commit, version code, and fingerprints for the
release.

## Upload to the existing internal test

In Google Play Console, open the **existing** `com.monseytrails.passenger`
app, then **Testing → Internal testing → Releases**. Edit the draft release
(or create a new release on the existing internal-testing track), upload
the verified `.aab`, resolve any package, version, or certificate warnings,
add release notes, and save. Complete Play Console's review and roll out to
internal testers. A successful GitHub build does **not** mean Google Play has
accepted the bundle; check the release status in Play Console before telling
testers it is available.