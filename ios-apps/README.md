# Bee Hive iPhone / iPad apps (Capacitor 6, iOS 13+)

The same two apps as the Android ones (`apps/`), as iOS apps. They open the live website, so website updates show up instantly (no rebuild).

| App | Bundle id | Opens |
|---|---|---|
| Bee Hive (customers) | `com.plodroid.beehive` | https://plodroid.github.io/store/ |
| Bee Hive Owner | `com.plodroid.beehive.owner` | https://plodroid.github.io/store/admin/ |

**Works on iOS 13 and newer** (iPhone 6s and up, iPads from 2015+). Capacitor 6 is used on purpose: Capacitor 7/8 need iOS 14/15+.

## Get the .ipa files
Every push that touches `ios-apps/` runs `.github/workflows/ios-apps.yml` on a GitHub macOS runner (free for this repo) and attaches `bee-hive-customer.ipa` and `bee-hive-owner.ipa` to a Release tagged `ios-<n>` (GitHub → Releases). Or run it by hand: Actions → *Build iPhone apps* → Run workflow.

The files are **unsigned**: Apple only lets a phone run an app signed by an Apple ID, and only Apple-ID owners can sign. So you sign them yourself, for free:

### Install with Sideloadly (Windows or Mac)
1. Install **Sideloadly** (sideloadly.io) and iTunes/Apple Devices on Windows.
2. Plug the iPhone in, tap *Trust this computer*.
3. Drag the `.ipa` into Sideloadly, enter your Apple ID, press **Start**.
4. On the iPhone: Settings → General → **VPN & Device Management** → your Apple ID → **Trust**. (iOS 16+: also turn on **Developer Mode** in Settings → Privacy & Security, then restart.)
5. Repeat for each iPhone. A free Apple ID signing lasts **7 days**, then re-sign (just press Start again) — or use **AltStore**, which refreshes it automatically over Wi-Fi. A free Apple ID allows 3 sideloaded apps per device at once.

(A paid Apple Developer account, £79/yr, removes the 7-day limit and allows TestFlight.)

## What matches Android and what differs
- Same name, icon, cream splash, cream status bar, same sites allowed (Stripe, Google, Firebase), same error page, location permission text.
- Customer: sign in with the emailed code. Card payments open Stripe Checkout inside the app.
- Owner: native Google sign-in (`@capacitor-firebase/authentication`). It needs an **iOS OAuth client** from Firebase: register the iOS app `com.plodroid.beehive.owner` in Firebase (Project settings → Your apps → Add app → iOS), download `GoogleService-Info.plist` and put it at `ios-apps/owner/GoogleService-Info.plist`. The build then adds it and the URL scheme automatically.
- Live location sharing works while the owner app is open. Keeping the screen awake while delivering needs **iOS 16.4+**; on older iOS keep the phone unlocked.
- Safe areas: the app puts the page inside the notch/home-bar area (`contentInset: always`), like Android's non-overlay status bar.

## Liquid Glass (native)
The bottom bar in both iPhone apps is a **real iOS tab bar** (local plugin `ios-apps/native-dock`, driven by `nativedock.js`), not CSS. Built with Xcode 26 and run on iOS 26+ it floats in an Apple **Liquid Glass** capsule (`UIGlassEffect`); on iOS 13–25 it is the normal system tab bar. Customer: Home / Saved / Basket / Account (badges for saved + basket). Owner: Today / Products / Orders / Messages / More (Events, Categories, Settings). The website's own bar is hidden only while the native one answers, so an old IPA without the plugin keeps working. Everything inside the page (cards, header, drawers) is web content and can't be real Liquid Glass; only native controls can.

## How it's built
`npx cap add ios` generates the Xcode project in CI, `patch.py` sets the name, icon, splash, location texts, iOS 13 target and the Google URL scheme, then `xcodebuild archive` with signing off, zipped into `Payload/*.app → .ipa`. Nothing generated is committed.
