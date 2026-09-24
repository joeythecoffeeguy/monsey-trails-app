# Android internal-test release

The Android bundle is built by the manual **Android internal-test bundle**
workflow in GitHub Actions, not by Replit Expo Launch or the existing Expo
project (which the owner cannot administer). The workflow uses pnpm at the
repository root, generates Android native files for
`artifacts/passenger-companion`, signs a store release, verifies it, and
uploads the `.aab` as a workflow artifact. It does **not** submit to Play.

## One-time owner setup in GitHub

First open the staged
[`android-internal.yml`](https://github.com/joeythecoffeeguy/monsey-trails-app/blob/main/android-internal.yml)
on GitHub. Click **Edit** (pencil), replace the filename at the top with
`.github/workflows/android-internal.yml`, and **Commit changes** to `main`.
GitHub will move it into the Actions folder; the root-level staging file
should disappear. The connected GitHub API refuses writes to that special
folder, so this one move requires your GitHub access. The workflow contains
no keys. Its signing helper is already in the public repository.

Then open the repository's **Settings → Secrets and variables → Actions**.
Set these repository **secrets**:

| Name | Value |
| --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Base64-encoded bytes of the Android upload keystore |
| `ANDROID_UPLOAD_STORE_PASSWORD` | Keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | Alias of the upload key inside the keystore |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Password for that key |

The owner needs a **new upload key**. Generate it on a computer you control
(not in this public repository), for example with Android Studio's **Build →
Generate Signed Bundle/APK → Create new** wizard or a local Java installation:

```sh
keytool -genkeypair -keystore monsey-trails-upload.jks \
  -alias monsey-trails-upload -keyalg RSA -keysize 4096 -validity 10000
keytool -exportcert -rfc -keystore monsey-trails-upload.jks \
  -alias monsey-trails-upload -file upload_certificate.pem
```

Choose strong passwords when prompted and store the `.jks` plus passwords
in a secure backup. To encode the keystore for the GitHub secret, run
`base64 < monsey-trails-upload.jks | tr -d '\n'` locally and paste the
output **only into** the `ANDROID_UPLOAD_KEYSTORE_BASE64` GitHub secret.
Set `ANDROID_UPLOAD_KEY_ALIAS` to `monsey-trails-upload` and the two
password secrets to the values you chose (for a PKCS12 keystore, the key
password is normally the same as the store password). Do not paste the encoded keystore,
passwords, or private key into chat, source, a GitHub variable, or a public
issue. The workflow decodes it into a temporary runner directory; no key or
password is uploaded as a build artifact.

Before uploading the bundle, check the existing app's **upload key
certificate** in Play Console (do not confuse it with the *app signing key
certificate*). If it already shows a different upload certificate, request
an **upload-key reset** in **Protected with Play → Play Store protection →
Manage Play app signing → Upload key certificate** and upload only
`upload_certificate.pem` when prompted. Wait for Google to approve the new
upload certificate. If this app has never registered an upload key, follow
the Play Console's first-release signing instructions. Do not attempt a
release using a certificate that Play still rejects.

Google's instructions:
https://support.google.com/googleplay/android-developer/answer/9842756

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