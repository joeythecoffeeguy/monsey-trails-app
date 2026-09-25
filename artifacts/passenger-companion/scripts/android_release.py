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
MANIFEST = APP / "android/app/src/main/AndroidManifest.xml"
OUTPUT = APP / "android/app/build/outputs/bundle/release"


def required(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise ValueError(f"Missing required GitHub Actions secret/variable: {name}")
    return value


def check_credentials() -> None:
    required("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY")
    required("EXPO_PUBLIC_DOMAIN")
    required("GOOGLE_MAPS_ANDROID_API_KEY")
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
    default_config = "    defaultConfig {\n"
    if source.count(default_config) != 1:
        raise ValueError("Expo's generated Android default configuration changed")
    source = source.replace(
        default_config,
        default_config
        + "        manifestPlaceholders = [googleMapsApiKey: System.getenv('GOOGLE_MAPS_ANDROID_API_KEY')]\n",
        1,
    )
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
    manifest = MANIFEST.read_text()
    application = re.search(r"<application\b[^>]*>", manifest, re.DOTALL)
    if not application or "com.google.android.geo.API_KEY" in manifest:
        raise ValueError("Could not safely configure the Android Maps API key")
    manifest = (
        manifest[:application.end()]
        + '\n    <meta-data android:name="com.google.android.geo.API_KEY" android:value="${googleMapsApiKey}" />'
        + manifest[application.end():]
    )
    GRADLE.write_text(source)
    MANIFEST.write_text(manifest)
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as env:
        env.write(f"ANDROID_UPLOAD_KEYSTORE_FILE={target}\n")
    print("Release signing configured from GitHub Actions secrets")


def remove_release_signing(source: str) -> str:
    """Leave the Gradle release bundle unsigned for Appcircle's Android Sign step."""
    start = source.index("    buildTypes {")
    end = source.index("    packagingOptions {", start)
    build_types = source[start:end]
    debug = "            signingConfig signingConfigs.debug\n"
    if build_types.count(debug) != 2 or build_types.count("        release {\n") != 1:
        raise ValueError("Expo's generated Android signing configuration changed")
    release_start = build_types.index("        release {\n")
    release = build_types[release_start:]
    if release.count(debug) != 1:
        raise ValueError("Could not isolate release signing config")
    build_types = build_types[:release_start] + release.replace(debug, "", 1)
    return source[:start] + build_types + source[end:]


def prepare_unsigned() -> None:
    GRADLE.write_text(remove_release_signing(GRADLE.read_text()))
    print("Unsigned release configured for Appcircle Android Sign")


def verify_generated_identity(app: dict, expected_id: str) -> None:
    if app["package"] != expected_id:
        raise ValueError("Unexpected application ID in app.json")
    metadata_file = OUTPUT / "output-metadata.json"
    if metadata_file.is_file():
        metadata = json.loads(metadata_file.read_text())
        if metadata["applicationId"] != expected_id:
            raise ValueError("Unexpected application ID in bundle metadata")
        if metadata["elements"][0]["versionCode"] != app["versionCode"]:
            raise ValueError("Unexpected Android version code in bundle metadata")
        return

    # The Android Gradle Plugin can build an AAB without emitting the APK-style
    # output-metadata.json. Check the generated release configuration instead.
    source = GRADLE.read_text()
    application_ids = re.findall(r"""(?m)^\s*applicationId\s+['"]([^'"]+)['"]\s*$""", source)
    version_codes = re.findall(r"(?m)^\s*versionCode\s+(\d+)\s*$", source)
    if application_ids != [expected_id] or version_codes != [str(app["versionCode"])]:
        raise ValueError("Generated Android application ID or version code does not match app.json")
    print("Bundle metadata absent; checked generated Android application ID and version code")


def verify_google_maps_configuration() -> None:
    source = GRADLE.read_text()
    if (
        "manifestPlaceholders = [googleMapsApiKey: System.getenv('GOOGLE_MAPS_ANDROID_API_KEY')]" not in source
        or 'android:name="com.google.android.geo.API_KEY" android:value="${googleMapsApiKey}"' not in MANIFEST.read_text()
    ):
        raise ValueError("Android Maps API key is not configured in the release")


def verify() -> None:
    app = json.loads((APP / "app.json").read_text())["expo"]["android"]
    expected_id = "com.monseytrails.passenger"
    verify_generated_identity(app, expected_id)
    verify_google_maps_configuration()
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
    if len(sys.argv) != 2 or sys.argv[1] not in ("check", "prepare", "prepare-unsigned", "verify"):
        raise SystemExit("Usage: android_release.py check|prepare|prepare-unsigned|verify")
    try:
        {"check": check_credentials, "prepare": prepare, "prepare-unsigned": prepare_unsigned,
         "verify": verify}[sys.argv[1]]()
    except ValueError as exc:
        # Actions annotations are readable even when job logs are unavailable.
        message = str(exc).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error title=Android release configuration::{message}", flush=True)
        raise SystemExit(1) from None
    except FileNotFoundError as exc:
        # Only report known filenames; never expose a keystore path or arguments.
        filename = Path(exc.filename or "").name
        if filename in {"app.json", "build.gradle", "output-metadata.json"}:
            detail = f"Missing release file: {filename}"
        elif filename in {"jarsigner", "keytool"}:
            detail = "Java signing verification tool is unavailable"
        else:
            detail = "Could not read a release file"
        print(f"::error title=Android release configuration::{detail}", flush=True)
        raise SystemExit(1) from None
    except OSError:
        print("::error title=Android release configuration::Could not read or write a release file", flush=True)
        raise SystemExit(1) from None
    except subprocess.CalledProcessError:
        # A subprocess command may contain passwords; never echo its arguments.
        print("::error title=Android release verification::Signing verification command failed", flush=True)
        raise SystemExit(1) from None