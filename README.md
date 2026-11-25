# Ledger Sawa — Android (React Native / Expo)

This project is the native Android client for CALVIN-LEDGER. `legacy-web/src/` preserves the supplied CALVIN-LEDGER React implementation for reference. Business rules in `src/services/ledgerLogic.js` are ported from the web app's `src/lib.js` (local month attribution, amount validation, rollover budget calculations, monthly caps, CSV-safe values, and six-month totals).

## 1. Configure Supabase

```bash
cp .env.example .env
```

Set the same Supabase project URL and **publishable/anon key** used by the web app:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Never put a Supabase service-role key in a mobile app. Keep `.env` out of Git.

## 2. Install and run on Android

Requirements: Node.js LTS, npm, Android Studio, Android SDK/platform tools, and a connected Android phone or emulator.

```bash
npm install
npx expo install --fix
npx expo start --clear
```

For a local native Android development build:

```bash
npx expo prebuild --platform android
npx expo run:android
```

The bottom navigation uses Ionicons (Home, Household, Personal, Income, Bills, Reports, Debts, Settings). Branding uses the white splash and `#14497A` launcher-icon background.

## 3. Build a release APK signed with the existing WayaWaya key

The build script expects the keystore to be somewhere inside:

`/Users/teddy/Documents/certificates/wayawayaa`

It expects alias `wayawaya`. It prompts for the keystore password and private-key password without echoing them. It does not save either password in source files, Gradle files, `.env`, or the ZIP.

1. Confirm the keystore file exists in the certificate directory. It should be a `.jks` or `.keystore` file.
2. In Terminal, enter the project root.
3. Run:

```bash
chmod +x scripts/build-signed-apk.sh
./scripts/build-signed-apk.sh
```

4. The script validates the alias with `keytool`, installs the Expo SDK-compatible native packages, generates the Android project, applies the signing configuration through `plugins/withAndroidSigning.js`, runs Gradle release assembly, and copies the APK to:

`dist/Ledger-Sawa-signed.apk`

If there is more than one keystore in the directory, specify the exact file first:

```bash
export LEDGER_KEYSTORE_PATH="/Users/teddy/Documents/certificates/wayawayaa/YOUR_KEYSTORE_FILE.jks"
./scripts/build-signed-apk.sh
```

If the directory or key file has a different location, update `CERT_DIR` in the script or set `LEDGER_KEYSTORE_PATH`.

### Verify the APK signature

```bash
$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | tail -1)/apksigner verify --verbose dist/Ledger-Sawa-signed.apk
```

You can also inspect the certificate with:

```bash
keytool -list -v -keystore "$LEDGER_KEYSTORE_PATH" -alias wayawaya
```

**Important:** an Android update must use the same signing key as the previously distributed app. Back up the keystore securely. Do not upload it to GitHub or include it in the project ZIP.

## 4. Data and offline behaviour

- Supabase remains the source of truth. Reads require a connection.
- Following the supplied web app, household expense inserts made while offline are stored in AsyncStorage under the same logical queue key and retried when connectivity returns or the app becomes active. Pending records are shown in the Household screen.
- The offline queue is not a full offline database: editing/deleting existing rows and other tables still require connectivity. A network timeout after the server accepted an insert can theoretically cause a duplicate on retry; the web implementation has the same insert-queue limitation.
- CSV export writes a local CSV and opens the Android share sheet. PDF export creates a printable PDF and opens the share sheet.
- Reports use local calendar month attribution and the source app's monthly budget / category budget formulas.

## 5. Supplied schema and source

`supabase-schema-complete.sql` and `legacy-web/src/` are included for reference. Do not blindly rerun schema changes against production; check the current Supabase schema and RLS policies first. All writes must be permitted by your existing RLS policies.

## 6. Validation notes

The JavaScript source has been statically parsed and local imports checked. This packaging environment cannot access your Supabase project, your Mac keystore, Android SDK, or emulator. Therefore an APK has **not** been built or signed here, and live RLS/end-to-end behaviour must be tested on your Mac before distribution.
# ledgerpowareactnative
