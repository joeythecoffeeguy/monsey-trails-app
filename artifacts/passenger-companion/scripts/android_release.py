"""Prepare and verify a GitHub Actions Android release; never print signing secrets."""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path


APP = Path(__file__).resolve().parents[1]
GRADLE = APP / "android/app/build.gradle"
OUTPUT = APP / "android/app/build/outputs/bundle/release"


def required(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise ValueError(f"Missing required GitHub Actions secret/variable: {name}")
    return value


def check_credentials() -> None:
    required("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY")
    required("EXPO_PUBLIC_DOMAIN")
    required("ANDROID_UPLOAD_STORE_PASSWORD")
    required("ANDROID_UPLOAD_KEY_ALIAS")
    required("ANDROID_UPLOAD_KEY_PASSWORD")
    required("ANDROID_UPLOAD_KEYSTORE_BASE64")


def prepare() -> None:
    check_credentials()
    encoded = required("ANDROID_UPLOAD_KEYSTORE_BASE64")
    target = Path(required("RUNNER_TEMP")) / "android-upload.jks"
    target.write_bytes(base64.b64decode(encoded, validate=True))
    target.chmod(0o600)

    # Do not interpolate any secret into build.gradle: Gradle reads them from
    # the runner's environment, and android/ is generated and gitignored.
    source = GRADLE.read_text()
    debug = "signingConfig signingConfigs.debug"
    if source.count(debug) != 2 or source.count("    signingConfigs {") != 1:
        raise ValueError("Expo's generated Android signing configuration changed")
    replacement = """    signingConfigs {
        release {
            storeFile file(System.getenv('ANDROID_UPLOAD_KEYSTORE_FILE'))
            storePassword System.getenv('ANDROID_UPLOAD_STORE_PASSWORD')
            keyAlias System.getenv('ANDROID_UPLOAD_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_UPLOAD_KEY_PASSWORD')
        }
"""
    source = source.replace("    signingConfigs {\n", replacement, 1)
    # Only the release build type changes; the debug build retains debug signing.
    source = source.replace(
        "        release {\n            // Caution! In production, you need to generate your own keystore file.\n"
        "            // see https://reactnative.dev/docs/signed-apk-android.\n"
        "            signingConfig signingConfigs.debug",
        "        release {\n            signingConfig signingConfigs.release",
        1,
    )
    if source.count(debug) != 1 or source.count("signingConfig signingConfigs.release") != 1:
        raise ValueError("Could not replace release signing config safely")
    GRADLE.write_text(source)
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as env:
        env.write(f"ANDROID_UPLOAD_KEYSTORE_FILE={target}\n")
    print("Release signing configured from GitHub Actions secrets")


def verify() -> None:
    app = json.loads((APP / "app.json").read_text())["expo"]["android"]
    expected_id = "com.monseytrails.passenger"
    metadata = json.loads((OUTPUT / "output-metadata.json").read_text())
    if app["package"] != expected_id or metadata["applicationId"] != expected_id:
        raise ValueError("Unexpected application ID")
    if metadata["elements"][0]["versionCode"] != app["versionCode"]:
        raise ValueError("Unexpected Android version code")
    bundles = list(OUTPUT.glob("*.aab"))
    if len(bundles) != 1:
        raise ValueError(f"Expected one app bundle, found {len(bundles)}")
    bundle = bundles[0]
    with zipfile.ZipFile(bundle) as archive:
        if archive.testzip() is not None or "base/manifest/AndroidManifest.xml" not in archive.namelist():
            raise ValueError("Invalid Android App Bundle archive")
    signature = subprocess.run(
        ["jarsigner", "-verify", str(bundle)], check=True, text=True, capture_output=True,
    ).stdout
    if "jar verified." not in signature:
        raise ValueError("Bundle is not signed")
    cert = subprocess.run(
        ["keytool", "-printcert", "-jarfile", str(bundle)],
        check=True, text=True, capture_output=True,
    ).stdout
    signer = subprocess.run(
        ["keytool", "-list", "-keystore", required("ANDROID_UPLOAD_KEYSTORE_FILE"),
         "-alias", required("ANDROID_UPLOAD_KEY_ALIAS"), "-storepass",
         required("ANDROID_UPLOAD_STORE_PASSWORD")],
        check=True, text=True, capture_output=True,
    ).stdout
    fingerprint = re.search(r"SHA256:\s*([0-9A-F:]+)", cert)
    if not fingerprint or fingerprint.group(1) not in signer:
        raise ValueError("Bundle signature does not match the upload keystore")
    digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
    print(f"Verified {expected_id} versionCode={app['versionCode']} sha256={digest}")
    print(f"Upload certificate SHA-256: {fingerprint.group(1)}")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("check", "prepare", "verify"):
        raise SystemExit("Usage: android_release.py check|prepare|verify")
    try:
        {"check": check_credentials, "prepare": prepare, "verify": verify}[sys.argv[1]]()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"Android release failed: {exc}") from None