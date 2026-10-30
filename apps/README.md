# Bee Hive Android apps (Capacitor)

Two small Android apps that open the live website, so website updates show up in the apps instantly (no rebuild).

| App | Package | Opens |
|---|---|---|
| Bee Hive (customers) | `com.plodroid.beehive` | https://plodroid.github.io/store/ |
| Bee Hive Owner | `com.plodroid.beehive.owner` | https://plodroid.github.io/store/admin/ |

The owner page is also usable in any browser at `/store/admin/`.

## Get the APKs
Every push that touches `apps/` runs `.github/workflows/mobile-apps.yml` (GitHub → Actions). It builds both apps and attaches `bee-hive-customer-debug.apk` and `bee-hive-owner-debug.apk` to a GitHub **Release** tagged `apps-<n>`. Open the release on your phone, download, install.

## Notes
- Customers sign in with the emailed code (Google sign-in is hidden inside the app). The owner app uses native Google sign-in (`@capacitor-firebase/authentication`), config in `apps/owner/android/app/google-services.json`.
- Debug APKs are signed with the shared `apps/debug.keystore` (public on purpose, test builds only).
- Card payments open Stripe Checkout inside the app and return to it.
- No push notifications yet (the owner still sees new orders live while the app is open).
- `apps/*/android` are Capacitor-generated; the `android/` folder at the repo root (if present) is a separate thing.

## Before the Play Store
1. Make a release **upload key**, enrol in Play App Signing, build a signed `.aab` (`./gradlew bundleRelease` in `apps/<app>/android`).
2. In Firebase → Project settings → the owner Android app, add the **SHA-1 that Play shows** (App signing page), or owner Google sign-in will fail in the store build.
3. Play may reject apps that are only a website wrapper: add real store listing content and consider push notifications.
