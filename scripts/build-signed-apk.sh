
#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# LEDGER SAWA - SIGNED ANDROID APK BUILDER
# --------------------------------------------------

# Resolve project directory from this script's location.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Your existing extensionless signing certificate.
CERT_PATH="/Users/teddy/Documents/certificates/wayawayaa"

# --------------------------------------------------
# 1. Locate the signing keystore
# --------------------------------------------------

CERT_PATH="/Users/teddy/Documents/certificates/wayawayaa"

if [[ -n "${LEDGER_KEYSTORE_PATH:-}" ]]; then
    KEYSTORE="$LEDGER_KEYSTORE_PATH"
else
    KEYSTORE="$CERT_PATH"
fi

if [[ ! -f "$KEYSTORE" ]]; then
    echo "Keystore file not found: $KEYSTORE" >&2
    exit 1
fi

if [[ ! -r "$KEYSTORE" ]]; then
    echo "Keystore file is not readable: $KEYSTORE" >&2
    exit 1
fi

export LEDGER_KEYSTORE_PATH="$KEYSTORE"

echo "Using signing keystore: $KEYSTORE"

# --------------------------------------------------
# 2. Configure signing alias and passwords
# --------------------------------------------------

export LEDGER_KEY_ALIAS="${LEDGER_KEY_ALIAS:-wayawaya}"

if [[ -z "${LEDGER_KEYSTORE_PASSWORD:-}" ]]; then
    read -rsp "Keystore password: " LEDGER_KEYSTORE_PASSWORD
    echo
    export LEDGER_KEYSTORE_PASSWORD
fi

if [[ -z "${LEDGER_KEY_PASSWORD:-}" ]]; then
    read -rsp "Private key password: " LEDGER_KEY_PASSWORD
    echo
    export LEDGER_KEY_PASSWORD
fi

# --------------------------------------------------
# 3. Validate signing certificate and alias
# --------------------------------------------------

echo ""
echo "Validating keystore and alias..."

keytool -list \
    -keystore "$LEDGER_KEYSTORE_PATH" \
    -storepass:env LEDGER_KEYSTORE_PASSWORD \
    -alias "$LEDGER_KEY_ALIAS" \
    >/dev/null

echo "Keystore validation successful."
echo "Alias: $LEDGER_KEY_ALIAS"

# --------------------------------------------------
# 4. Check build requirements
# --------------------------------------------------

for command in node npm java keytool; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "Required command not found: $command" >&2
        exit 1
    fi
done

echo ""
echo "Node version:"
node --version

echo "Java version:"
java -version

if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
    echo "package.json not found. Invalid project directory." >&2
    exit 1
fi

# --------------------------------------------------
# 5. Install dependencies
# --------------------------------------------------

echo ""
echo "Installing npm dependencies..."

npm install

echo ""
echo "Aligning Expo dependencies..."

npx expo install --fix

# --------------------------------------------------
# 6. Generate Android native project
# --------------------------------------------------

echo ""
echo "Generating Android project..."

npx expo prebuild --platform android --clean

# --------------------------------------------------
# 7. Build signed release APK
# --------------------------------------------------

echo ""
echo "Building signed release APK..."

cd "$PROJECT_ROOT/android"

./gradlew --no-daemon assembleRelease

# --------------------------------------------------
# 8. Copy APK to distribution directory
# --------------------------------------------------

cd "$PROJECT_ROOT"

APK_SOURCE="$PROJECT_ROOT/android/app/build/outputs/apk/release/app-release.apk"
DIST_DIR="$PROJECT_ROOT/dist"
APK_DESTINATION="$DIST_DIR/Ledger-Sawa-signed.apk"

if [[ ! -f "$APK_SOURCE" ]]; then
    echo "Release APK was not generated." >&2
    exit 1
fi

mkdir -p "$DIST_DIR"

cp "$APK_SOURCE" "$APK_DESTINATION"

# --------------------------------------------------
# 9. Verify APK signature
# --------------------------------------------------

echo ""
echo "Verifying APK signature..."

if command -v apksigner >/dev/null 2>&1; then
    apksigner verify --verbose "$APK_DESTINATION"
elif [[ -n "${ANDROID_HOME:-}" && -x "$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -n 1)/apksigner" ]]; then
    APKSIGNER="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -n 1)/apksigner"
    "$APKSIGNER" verify --verbose "$APK_DESTINATION"
else
    echo "WARNING: apksigner not found; APK signature verification skipped."
fi

# --------------------------------------------------
# 10. Build summary
# --------------------------------------------------

echo ""
echo "============================================"
echo "       LEDGER SAWA APK BUILD COMPLETE"
echo "============================================"
echo ""
echo "APK:"
echo "$APK_DESTINATION"
echo ""
echo "Signing alias: $LEDGER_KEY_ALIAS"
echo "Keystore: $LEDGER_KEYSTORE_PATH"
echo ""
ls -lh "$APK_DESTINATION"
echo ""
echo "Install using:"
echo "adb install -r \"$APK_DESTINATION\""
echo ""
