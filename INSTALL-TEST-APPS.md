# Bee Hive: test apps, install guide

Files in this bundle (GitHub → Releases → **test-bundle-1**):

| File | For | What it is |
|---|---|---|
| `bee-hive-customer-debug.apk` | Android (Redmi) | customer app |
| `bee-hive-owner-debug.apk` | Android (Redmi) | owner app |
| `bee-hive-customer.ipa` | iPhone / iPad (iOS 13+) | customer app |
| `bee-hive-owner.ipa` | iPhone / iPad (iOS 13+) | owner app |
| `bee-hive-source.zip` | PC | the whole project (website + apps + build files) |

All four apps just open the **live website**, so shop changes show up instantly with no reinstall. They are test builds (orders are test orders).

---

## A. Redmi (Android 7+)

1. On the Redmi open the Release page in Chrome and tap **`bee-hive-customer-debug.apk`** and **`bee-hive-owner-debug.apk`** to download. (Or copy them over USB / send them to yourself on Telegram/Drive.)
2. Open the downloaded file (Downloads app → tap the `.apk`).
3. First time only, Xiaomi asks permission: tap **Settings** → turn on **Allow from this source** for Chrome (or your Files app) → go back → **Install**.
4. If MIUI/HyperOS shows *"Install via USB / security check"* or *"Scan for risks"*: tap **Install anyway** / **Continue**. If it says *Blocked by Play Protect*: **More details → Install anyway**.
5. Tap **Open**. Repeat for the second app.

**Customer app:** sign in with your email, it sends a 4-digit code.
**Owner app:** tap *Continue with Google* and use the shop owner's Google account. If you get a grey line of text at the bottom, screenshot it and send it to the developer.
Owner app: allow **Location** when asked (the shop shares its position only while a delivery is on its way).

Updating: install the new APK over the old one (keeps data). Uninstall first only if Android says *"App not installed"*.

---

## B. iPhone / iPad (iOS 13 or newer)

Apple only runs apps that are signed with an Apple ID, so you sign the two `.ipa` files yourself, free, with **Sideloadly**. You need a PC or Mac for this part.

1. Download the two `.ipa` files from the Release page onto the PC/Mac.
2. Install **Sideloadly** (sideloadly.io). On Windows also install **iTunes** and **iCloud** from apple.com (not the Microsoft Store versions), then restart.
3. Plug the iPhone into the PC with a cable. Unlock it and tap **Trust This Computer**.
4. Open Sideloadly: your iPhone shows at the top. Drag **`bee-hive-customer.ipa`** into the IPA box. Type your **Apple ID** (a free one is fine) and press **Start**. Enter the password (use an app-specific password if asked). Wait for "Done".
5. Do the same for **`bee-hive-owner.ipa`** (a free Apple ID allows 3 sideloaded apps at once).
6. On the iPhone: **Settings → General → VPN & Device Management → [your Apple ID] → Trust**.
7. **iOS 16 and newer only:** Settings → **Privacy & Security → Developer Mode → On** → restart the phone → **Turn On** when asked.
8. Open **Bee Hive** / **Bee Hive Owner** from the home screen.
9. **Every 7 days** the free signing expires and the app won't open: plug in, press **Start** again in Sideloadly (data stays). **AltStore** can do this automatically over Wi-Fi if you prefer.

Several iPhones: repeat steps 3–7 for each one (the same `.ipa` files work on all of them, iOS 13 and newer, iPhone 6s and up).

**Owner app on iPhone:** *Continue with Google* only works after a one-time Firebase setup (add an iOS app `com.plodroid.beehive.owner`, put its `GoogleService-Info.plist` in `ios-apps/owner/`, rebuild). Until then use the owner page in Safari: `https://plodroid.github.io/store/admin/`.
On iOS 26 the bottom bar is Apple's Liquid Glass; on older iOS it is the normal iPhone tab bar.

---

## C. Source zip

`bee-hive-source.zip` = the repo at this build: website (`index.html`, `app.js`, …), owner page (`admin/`), Android apps (`apps/`), iPhone apps (`ios-apps/`), Firebase rules, Apps Script (`apps-script/`), tests. See `README.md`, `apps/README.md`, `ios-apps/README.md`. New APK/IPA builds come from GitHub Actions (push to `main`, or Actions → *Run workflow*).
