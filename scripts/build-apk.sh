#!/bin/bash
# Builds the signed Android app (APK) that runearn.fun/download serves.
#
#   bash scripts/build-apk.sh
#
# The first run creates the app's signing key in ~/RUNNER-signing (outside the
# repo). Keep that folder and its password forever and back them up: every
# update must be signed with the same key, or players have to uninstall (and
# lose their runs) to install it. The password is typed here and never stored.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"
export JAVA_HOME="${RUNNER_JAVA_HOME:-$HOME/.local/jdk21}" # Gradle 8.11 needs Java 21
BUILD_TOOLS="$(ls -d "$HOME"/Library/Android/sdk/build-tools/* | sort -V | tail -1)"
KEY_DIR="$HOME/RUNNER-signing"
KEYSTORE="$KEY_DIR/runner-release.p12"

if [ ! -f "$KEYSTORE" ]; then
  echo "First build: creating the RUNNER app signing key in $KEY_DIR."
  echo "Choose a strong password and write it down somewhere safe (a password manager)."
  mkdir -p "$KEY_DIR" && chmod 700 "$KEY_DIR"
  "$JAVA_HOME/bin/keytool" -genkeypair -storetype PKCS12 -keystore "$KEYSTORE" -alias runner \
    -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=RUNNER, O=RUNNER, C=ID"
  chmod 600 "$KEYSTORE"
  echo "Key created. Back up $KEY_DIR now (e.g. to an encrypted USB drive)."
fi

read -r -s -p "Signing key password: " RUNNER_KEYSTORE_PASSWORD; echo
export RUNNER_KEYSTORE="$KEYSTORE" RUNNER_KEYSTORE_PASSWORD RUNNER_KEY_ALIAS=runner

echo "Copying the web app into the Android project…"
node scripts/copy-web.mjs
npx cap sync android

echo "Building the release APK (a few minutes the first time)…"
(cd android && ./gradlew --quiet assembleRelease)
unset RUNNER_KEYSTORE_PASSWORD

APK=android/app/build/outputs/apk/release/app-release.apk
"$BUILD_TOOLS/apksigner" verify "$APK"
mkdir -p downloads
cp "$APK" downloads/runner.apk

VERSION="$(sed -n 's/.*versionName "\(.*\)".*/\1/p' android/app/build.gradle)"
CODE="$(sed -n 's/.*versionCode \([0-9]*\).*/\1/p' android/app/build.gradle)"
SHA256="$(shasum -a 256 downloads/runner.apk | awk '{print $1}')"
CERT="$("$BUILD_TOOLS/apksigner" verify --print-certs downloads/runner.apk | sed -n 's/.*certificate SHA-256 digest: //p' | head -1)"
SIZE="$(stat -f%z downloads/runner.apk)"
cat > downloads/android.json <<JSON
{
  "version": "$VERSION",
  "versionCode": $CODE,
  "file": "/downloads/runner.apk",
  "size": $SIZE,
  "sha256": "$SHA256",
  "certSha256": "$CERT",
  "built": "$(date -u +%Y-%m-%d)"
}
JSON

echo
echo "Done: downloads/runner.apk (version $VERSION, $((SIZE / 1024 / 1024)) MB)"
echo "SHA-256: $SHA256"
echo "Signing certificate: $CERT"
echo "Commit and push downloads/ to publish it at runearn.fun/download."
