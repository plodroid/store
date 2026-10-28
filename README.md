# Plodroid Store

A little shop on the internet, plus a phone app that runs it.

- **The website** (for customers): people look at products, put them in a basket, place an order, and can send feedback.
  Live address: **https://plodroid.github.io/store/**
- **The Store Owner app** (for you, on Android): you add products, change prices and stock, sort products into categories, deal with orders, read feedback, and get a ping on your phone when something happens.

Both talk to the same **Firebase** project. Think of Firebase as a shared notebook that lives on Google's computers: the app writes in it, the website reads from it, so they always agree.

> **Important right now:** online payment is **not switched on**. The checkout is a clearly labelled **test checkout**. No money is ever taken, no card details are ever asked for, and test orders never count as money in the app.

---

## Contents

1. [What's done and what's waiting for you](#1-whats-done-and-whats-waiting-for-you)
2. [How the pieces fit together](#2-how-the-pieces-fit-together)
3. [Folder map](#3-folder-map)
4. [Tools you need](#4-tools-you-need)
5. [Install the dependencies](#5-install-the-dependencies)
6. [Run the website on your computer](#6-run-the-website-on-your-computer)
7. [Run the Android app while developing](#7-run-the-android-app-while-developing)
8. [Create the Firebase project](#8-create-the-firebase-project)
9. [Register the website and the app with Firebase](#9-register-the-website-and-the-app-with-firebase)
10. [Files you need to download or edit](#10-files-you-need-to-download-or-edit)
11. [Set up the database (Firestore) and its rules](#11-set-up-the-database-firestore-and-its-rules)
12. [Set up photo storage](#12-set-up-photo-storage)
13. [Deploy the server code (Cloud Functions)](#13-deploy-the-server-code-cloud-functions)
14. [Push notifications](#14-push-notifications)
15. [Build the APK](#15-build-the-apk)
16. [Install the app on a phone](#16-install-the-app-on-a-phone)
17. [Put the website online](#17-put-the-website-online)
18. [Test everything, step by step](#18-test-everything-step-by-step)
19. [When something goes wrong](#19-when-something-goes-wrong)
20. [Adding real payments later (Stripe / PayPal)](#20-adding-real-payments-later-stripe--paypal)

---

## 1. What's done and what's waiting for you

| Part | Status |
|---|---|
| Website: catalogue, categories, search, basket, test checkout, feedback form | ✅ Built and tested in a browser (with a stand-in Firebase) |
| Website: honest "getting ready" screen until Firebase is set up | ✅ Built and tested |
| Server code: place order (checks prices + stock), feedback, alerts, restock on cancel | ✅ Built, 20 automatic tests pass |
| Security rules (who can read/write what) | ✅ Written. ⚠️ Not yet run against real Firebase (needs your project) |
| Android app (all screens) | ✅ Built into an APK by GitHub. ⚠️ Not yet opened on a real phone by us |
| Android app "demo mode" (sample data, nothing saved) | ✅ Works without Firebase |
| **Your Firebase project** | ⏳ **Waiting for you** — steps 8–14 |
| Push notifications on your phone | ⏳ Built; works once steps 8–14 are done. Not yet tested on a device |
| Real payments | ❌ Not started on purpose — see step 20 |

The app's dashboard numbers come only from real stored orders. Test orders are counted on their own and never added to money totals.

---

## 2. How the pieces fit together

```
  Customer's browser                 Google's computers (Firebase)                Your phone
 ┌──────────────────┐   reads     ┌──────────────────────────────┐   reads +    ┌──────────────┐
 │  Website          │ ─────────▶ │ Firestore (the notebook)       │ ◀────────── │ Store Owner  │
 │  (GitHub Pages)   │            │  products, categories, settings│   writes     │ app          │
 │                   │  "place    │  orders, feedback (private)    │             │              │
 │                   │  order"    │                                │             │              │
 │                   │ ─────────▶ │ Cloud Functions (the guard)    │  push alert │              │
 │                   │            │  checks prices & stock, saves  │ ──────────▶ │              │
 └──────────────────┘            │  the order, sends alerts       │             └──────────────┘
                                  │ Storage (product photos)       │
                                  └──────────────────────────────┘
```

- Customers can only **read** what's on sale. They can never read other people's orders or feedback.
- Orders and feedback go through **Cloud Functions**: small programs on Google's computers that act like a guard at the door. The guard looks up the real price and stock itself, so nobody can cheat by changing prices in their browser, and two people can't both buy the last item.
- Only **your** account (the "owner") can change products, see orders, and so on.

---

## 3. Folder map

```
store/
├── index.html, styles.css, app.js   ← the website (no build step needed)
├── firebase-config.js               ← website settings: paste your Firebase keys here
├── firestore.rules                  ← who may read/write the database
├── firestore.indexes.json           ← a database shortcut the reminders need
├── storage.rules                    ← who may upload photos
├── firebase.json                    ← tells the Firebase tool where everything is
├── .firebaserc.example              ← copy to .firebaserc and put your project id in
├── functions/                       ← server code (Cloud Functions, Node.js)
│   ├── index.js                     ← list of all functions
│   ├── src/orders.js                ← "place order" (price + stock checks)
│   ├── src/feedback.js              ← "send feedback"
│   ├── src/triggers.js              ← alerts, restock on cancel, reminders
│   ├── src/notify.js                ← sends push notifications to your phone
│   ├── src/shop-logic.js            ← the pure rules (easy to test)
│   ├── src/payments/                ← payment providers: mock now, Stripe later
│   └── test/                        ← automatic tests
├── android/                         ← the Store Owner app (Kotlin + Jetpack Compose)
│   └── app/src/main/java/com/plodroid/storeowner/
│       ├── domain/                  ← plain business rules (money, analytics, form checks)
│       ├── data/                    ← talking to Firebase, demo data, photos, errors
│       ├── notify/                  ← push notifications
│       └── ui/                      ← every screen, the tab bar, the theme
└── .github/workflows/android-apk.yml ← GitHub builds the APK (compile only)
```

---

## 4. Tools you need

| Tool | What it's for | Needed for |
|---|---|---|
| A Google account | Firebase lives in your Google account | Everything live |
| [Node.js 22](https://nodejs.org) | Runs the server code and the Firebase tool | Steps 5, 13 |
| Firebase CLI (`npm i -g firebase-tools`) | A command-line helper that uploads rules and server code | Steps 11–13 |
| [Android Studio](https://developer.android.com/studio) (optional) | Lets you run/edit the app on your computer | Step 7 |
| An Android phone (6.0 or newer) | To use the app | Step 16 |
| Python 3 (optional) | A one-line local web server | Step 6 |

You **don't** need Android Studio just to get the APK — GitHub builds it for you (step 15).

---

## 5. Install the dependencies

The website has none. For the server code:

```bash
cd functions
npm install
npm test        # runs the automatic tests (should say "pass 20")
```

The Android app downloads its own dependencies the first time it's built.

---

## 6. Run the website on your computer

```bash
cd store
python3 -m http.server 8000
```

Open `http://localhost:8000`. Then:

- **Not connected yet?** Customers see "The shop is getting ready." That's on purpose — the site never shows made-up products as if they were real.
- **Want to look around anyway?** Open `http://localhost:8000/?preview` — you'll see clearly labelled sample products, and ordering is switched off.
- **Once `firebase-config.js` has your keys**, it shows your real products.

The browser console (F12) always says which mode is on.

---

## 7. Run the Android app while developing

1. Open the `android` folder in Android Studio.
2. Wait for it to finish "syncing".
3. Press the green ▶ Run button with a phone plugged in (or an emulator).

From the command line instead:

```bash
cd android
./gradlew assembleDebug        # builds app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest    # runs the app's unit tests (money, dashboard maths, form checks)
```

> The app's unit tests were written but **not run** for this delivery (they need the Android build tools, and GitHub Actions was kept to compiling only). Run the command above once to check them.

**Demo mode:** on the first screen, tap **"Look around with sample data first"**. Everything works on sample data stored only on that phone. A blue bar says "Demo mode" the whole time, and nothing reaches the website.

---

## 8. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Create a project**. Call it something like `plodroid-store`.
2. Google Analytics: you can switch it **off**. The app doesn't use it.
3. When it's ready, click the ⚙️ gear → **Usage and billing** → **Details & settings** → change the plan to **Blaze (pay as you go)**.
   - Why: the "guard" (Cloud Functions) and photo storage need it. A small shop normally stays inside the free allowance, so it usually costs £0. **Set a budget alert** (e.g. £5) so you'd be warned.
4. Left menu → **Build → Firestore Database → Create database** → choose location **`europe-west2 (London)`** → **Start in production mode**.
   - The server code is set to London too. If you pick somewhere else, change `region` in `functions/index.js` and `FUNCTIONS_REGION` in `firebase-config.js` to match.
5. Left menu → **Build → Authentication → Get started** → **Email/Password** → **Enable** → Save.
6. Still in Authentication → **Users → Add user** → type **your** email and a strong password. This is the shop owner login.
7. Copy that user's **User UID** (the long code in the list).
8. Left menu → **Firestore Database → Start collection** → Collection ID: `owners` → Document ID: **paste your User UID** → add a field `email` (string) with your email → Save.
   - This is what makes you the owner. Only someone with console access can create this, so nobody else can make themselves owner.
   - Forgot the UID? Sign in on the app — it shows your code and a Copy button.
9. Left menu → **Build → Storage → Get started** → production mode → same London location.

---

## 9. Register the website and the app with Firebase

**The website**

1. Project overview → **Add app** → the **`</>`** (Web) icon → nickname "Website" → Register (no hosting needed).
2. You'll see a `firebaseConfig = { ... }` block. Keep that page open for step 10.

**The Android app**

1. Project overview → **Add app** → **Android** icon.
2. Package name: **`com.plodroid.storeowner`** (it must be exactly this).
3. Nickname "Store Owner". The SHA-1 box can stay empty.
4. **Download `google-services.json`**. Skip the remaining "add SDK" steps — that's already done in the code.

---

## 10. Files you need to download or edit

| File | What to do | Secret? |
|---|---|---|
| `firebase-config.js` | Replace each `PASTE_...` with the values from the Web app's `firebaseConfig` | No: these are public "address" values, and the security rules protect the data |
| `google-services.json` | Put it on your phone and pick it in the app (step 16). **Or** put it in `android/app/` before building to bake it in | No, but don't commit it — it's in `.gitignore` |
| `.firebaserc` | Copy `.firebaserc.example` to `.firebaserc` and put your project id in | No |
| `functions/.env` (optional) | `ENFORCE_APP_CHECK=true` once you set up App Check | No |

**Never** put these in the project: service-account files, passwords, Stripe secret keys, or app signing keys.

Optional, to bake the Firebase file into GitHub-built APKs: repo **Settings → Secrets and variables → Actions → New repository secret**, name `GOOGLE_SERVICES_JSON_B64`, value = the output of `base64 -w0 google-services.json`.

---

## 11. Set up the database (Firestore) and its rules

The rules are like a bouncer list for the notebook. Upload them with the Firebase CLI:

```bash
npm i -g firebase-tools
firebase login
cd store
cp .firebaserc.example .firebaserc        # then edit it: put your project id
firebase deploy --only firestore:rules,firestore:indexes
```

What the rules allow:

- **Anyone:** read products that are *visible and not removed*, visible categories, and the public shop settings.
- **Nobody directly:** create orders or feedback. Only the server code (step 13) can, after checking them.
- **Only the owner:** change products and categories, read and update orders, read feedback and alerts.
- Cost price, SKU and barcode live in a separate owner-only place (`productPrivate`), so customers can never see them.

Optional tidy-up: Firestore → **TTL** → add a policy on collection `rateLimits`, field `expiresAt`. Old anti-spam counters then delete themselves.

---

## 12. Set up photo storage

```bash
firebase deploy --only storage
```

Anyone can *see* product photos. Only the owner can upload them, and only JPG/PNG/WebP under 5 MB. The app shrinks big photos before uploading.

The first time, the tool may ask whether Storage can "read Firestore". **Say yes.** That's how the photo rules check that you're the owner.

---

## 13. Deploy the server code (Cloud Functions)

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

This uploads seven small programs:

| Function | When it runs | What it does |
|---|---|---|
| `placeOrder` | Customer presses "Place test order" | Checks the basket against **real** prices and stock, saves the order, lowers stock — all in one go, so the last item can't be sold twice. Retrying never makes a duplicate. |
| `submitFeedback` | Customer sends feedback | Checks it, blocks spam, stores it privately |
| `onOrderCreated` | A new order is saved | Sends "New order PS-XXXXXX" to your phone |
| `onFeedbackCreated` | New feedback is saved | Sends "New customer feedback" |
| `onProductUpdated` | Stock goes down | Alerts you once when it reaches your low-stock line, and once when it sells out |
| `onOrderUpdated` | You cancel an order | Puts the items back into stock, exactly once |
| `remindStaleOrders` | Every 30 minutes | Nudges you about orders waiting over 2 hours |

Notifications never include the customer's name, phone or address, just the order number, item count and total.

---

## 14. Push notifications

They're already wired up. Firebase Cloud Messaging (Google's "send a ping to a phone" service) is on by default in new projects, and the server code uses Google's own credentials, so there's **no server key to copy**.

For them to arrive:

1. Steps 8–13 are done (especially step 13).
2. In the app: allow notifications when asked. On Android 13+ the phone shows a permission pop-up; you can also go **More → Notifications → Turn on notifications**.
3. You're signed in. The app tells the server "send alerts to this phone" when you sign in, and stops when you sign out.

Tapping an order alert opens that order, and tapping a feedback alert opens that message. You can switch each kind on/off in **More → Settings → Alerts to send me**.

> Notifications have **not** been tested on a real phone yet, because they need your Firebase project. Test them with step 18.

---

## 15. Build the APK

An **APK** is the install file for an Android app.

**Option A: let GitHub build it (no tools needed).** Every time the `android/` folder changes on `main`, GitHub's workflow compiles the app and attaches the APK to a **Release**:

- Newest APK: **https://github.com/plodroid/store/releases/latest/download/plodroid-store-owner-debug.apk**
- All builds: https://github.com/plodroid/store/releases

The workflow (`.github/workflows/android-apk.yml`) only compiles. It doesn't deploy the website or run anything else.

**Option B: on your computer:** `cd android && ./gradlew assembleDebug`. The file appears at `android/app/build/outputs/apk/debug/app-debug.apk`.

**About "debug":** the APK is a **debug build**, signed with Android's standard test key. It installs and works normally, but it's not a Play-Store release. For a store release you'd create your own signing key (keystore), keep it secret, add a `signingConfig` in `android/app/build.gradle.kts`, and build `assembleRelease`.

---

## 16. Install the app on a phone

1. On the phone, open the APK link from step 15 and download it.
2. Open the downloaded file. Android will ask to allow installing from this source (your browser or Files app). Allow it.
3. Tap **Install**, then **Open**.
4. First screen, **Connect your shop**: tap **Choose google-services.json** and pick the file from step 9. (Email it to yourself or put it in Google Drive first.)
5. Sign in with the owner email and password from step 8.
6. Follow the short intro and allow notifications.

Works on Android **6.0 and newer**, phones of all sizes. One APK works on all common phone types.

---

## 17. Put the website online

The website is hosted by **GitHub Pages** straight from the `main` branch. That's already switched on: **https://plodroid.github.io/store/**

To publish a change: edit the files and push to `main`. GitHub republishes the page within about a minute. (This is GitHub's own Pages publishing, not the APK workflow.)

After you fill in `firebase-config.js` and push it, the live site switches from "getting ready" to your real shop.

---

## 18. Test everything, step by step

Do these in order once steps 8–16 are done. Keep the website open on a computer and the app on your phone.

**Products & stock**
1. App → **More → Categories → Add** → "Drinks". The website gets a "Drinks" tab within seconds.
2. App → **Products → Add** → name "Test Water", price `1.00`, stock `3`, category Drinks, add a photo → **Add product**. It appears on the website.
3. Tap the product → change stock to `1` → **Save stock**. The website shows "Only 1 left".
4. Turn off **Show on website**. It disappears from the website. Turn it back on.

**Orders**
5. Website: add Test Water to the basket → **Checkout** → fill in your name and phone → **Place test order**. You get a reference like `PS-7K3D9Q` and a "test order, no payment taken" note.
6. Phone: you should get a **New order** notification. Tap it and the order opens.
7. The website now shows Test Water as **Sold out**, and you get an **Out of stock** alert.
8. In the order, press **Confirm order → Start preparing → Mark ready → Mark collected**.
9. Place another test order, then **Cancel order** in the app. Stock goes back up.

**Feedback**
10. Website footer → **Send feedback** → 4 stars + a message → Send. You get an alert, and it appears under **Feedback** with an unread dot.

**Safety checks**
11. Sign out of the app. Signed-out (or non-owner) accounts can't see orders.
12. Turn on airplane mode in the app and try to change stock. The app says nothing was saved.

**Dashboard**
13. Home shows your test orders counted as **test**, and "Money received" stays **£0.00**, because test orders never count as money.

---

## 19. When something goes wrong

| What you see | Why | Fix |
|---|---|---|
| Website: "The shop is getting ready" | `firebase-config.js` still has `PASTE_...` | Step 10, then push |
| Website: "We couldn't load the shop" | Rules not deployed, wrong project id, or no internet | Step 11; check the project id; F12 console shows the exact error |
| Checkout: "We couldn't reach the shop…" | Server code not deployed, or region mismatch | Step 13; region must match in `functions/index.js` and `firebase-config.js` |
| Checkout: "Online ordering is paused" | Both Collection and Delivery are off | App → Settings → How customers get their order |
| App: "This file is for a different app" | The Android app in Firebase has another package name | Register `com.plodroid.storeowner` exactly (step 9) |
| App: "Almost there… isn't the shop owner yet" | No `owners/{your UID}` document | Step 8.8 (the app shows your UID with a Copy button) |
| App: "This account isn't allowed to do that" | Rules not deployed, or not signed in as owner | Step 11 and step 8.8 |
| App: "The database needs a quick setup step (an index)" | Index missing | `firebase deploy --only firestore:indexes` |
| No notifications | Permission off, functions not deployed, or battery saver | Step 14; also check Settings → Apps → Store Owner → Battery → Unrestricted |
| Phone: "App not installed" | An older build signed differently is installed | Uninstall the old app first |
| Photo won't upload | Storage not set up or rules not deployed | Step 12 |
| Deploy says billing required | Project is on the free Spark plan | Upgrade to Blaze (step 8.3) |

---

## 20. Adding real payments later (Stripe / PayPal)

The payment code is kept behind one small door, so switching it on later doesn't mean rewriting the shop:

- `functions/src/payments/index.js` holds the list of payment providers. Today it only has `mock`.
- `functions/src/payments/mock.js` is the test provider: no money, every order marked `isTest: true`, `paymentStatus: "mock"`.
- `functions/src/payments/stripe.js` is a **placeholder** with step-by-step notes. It isn't connected to anything.

Orders already keep **order status** (new → confirmed → preparing → ready → completed / cancelled) separate from **payment status** (mock / pending / paid / failed / refunded).

To add Stripe:
1. `cd functions && npm i stripe` and store your secret key with `firebase functions:secrets:set STRIPE_SECRET_KEY` (never in the code).
2. Fill in `stripe.js` so it creates a PaymentIntent and returns `paymentStatus: "pending"`.
3. Add a small webhook function that Stripe calls to mark orders `paid`, `failed` or `refunded`.
4. On the website, use Stripe's own card form (Stripe.js). Card details go straight to Stripe and never touch your site or Firebase.
5. Register the provider in `payments/index.js` and send `payment: { method: "stripe" }` from the checkout.

PayPal would follow the same pattern with its own provider file.

---

### Data shapes (for developers)

`products/{id}` (public): `name`, `price` (GBP pounds, e.g. `2.4`), `stock` (whole number ≥ 0), `categoryId`, `image`, `imagePath`, `description`, `unit`, `visible`, `archived`, `featured`, `sortOrder`, `lowStockThreshold`, `createdAt`, `updatedAt`
`productPrivate/{id}` (owner only): `costPrice`, `sku`, `barcode`, `updatedAt`
`categories/{id}`: `name`, `description`, `image`, `imagePath`, `sortOrder`, `visible`, `createdAt`, `updatedAt`
`orders/{id}` (server writes, owner reads): `ref`, `status`, `paymentStatus`, `paymentProvider`, `isTest`, `items[]` (name/qty/price **snapshot**), `productIds`, `subtotal`, `deliveryFee`, `total`, `totalPence`, `fulfilment`, `customer`, `address`, `note`, `createdAt`, `updatedAt`
`feedback/{id}` (server writes, owner reads): `name`, `orderRef`, `orderId`, `rating`, `message`, `read`, `archived`, `createdAt`
`settings/site` (public): `storeName`, `heroTitle`, `heroSubtitle`, `announcement`, `whatsapp`, `collection`, `delivery`, `deliveryFee`, `currency`
`settings/owner`, `notifications/{id}`, `ownerDevices/{token}`, `owners/{uid}`: owner only

Older product documents that only had `category` (a name) won't show on the website until they're edited once in the app, which gives them a `categoryId`, `visible` and `archived`.
