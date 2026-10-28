# Store — a storefront driven by the POS app

A single-page, Firebase-backed shop. The Android POS app writes to Firestore,
this site is already listening, and the page repaints without a reload or a deploy.

Live: **https://plodroid.github.io/store/**

```
index.html           the whole page
app.js               realtime listeners, product grid, basket, animations
firebase-config.js   ← the only file you edit
```

---

## 1. Turn it on

Right now the site runs on demo products so you can look at the design.
To go live, open `firebase-config.js` and paste your web app config:

Firebase console → Project settings → Your apps → Web app → Config.

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza…",
  authDomain: "yourproject.firebaseapp.com",
  projectId: "yourproject",
  storageBucket: "yourproject.appspot.com",
  messagingSenderId: "…",
  appId: "1:…",
};
```

Commit. That's it — the demo products disappear the moment Firestore answers.

> The web API key is public by design. Firestore rules are what protect the data, not the key.

## 2. Enable GitHub Pages

Repo → Settings → Pages → Source: `Deploy from a branch` → `main` / `root`.

---

## 3. The data contract

Both halves must agree on these shapes or they stop talking.

### `products/{autoId}`

| field | type | notes |
|---|---|---|
| `name` | string | required |
| `price` | number | **in DZD, no decimals** |
| `category` | string | drives the filter pills automatically |
| `stock` | number | `0` → renders as Sold out |
| `image` | string | any public URL (Firebase Storage works) |
| `description` | string | optional, clamped to 2 lines |
| `featured` | bool | optional, shows a "Pick" badge and sorts first |
| `order` | number | optional tiebreaker |
| `active` | bool | `false` hides it from the site without deleting it |
| `updatedAt` | timestamp | optional, for your own auditing |

### `settings/site`

Everything here is editable from the app — site copy without touching code.

```json
{
  "storeName": "Plodroid Store",
  "tagline": "A storefront that never disagrees with the till.",
  "heroTitle": "Your shop counter,\nnow a storefront.",
  "heroSubtitle": "…",
  "announcement": "",
  "whatsapp": "https://wa.me/213XXXXXXXXX",
  "downloadUrl": "https://…/pos.apk",
  "currency": "DZD",
  "rates": { "DZD": 1, "GBP": 0.00333, "USD": 0.00446 }
}
```

`announcement` non-empty → the banner under the nav appears.
`rates` are **1 DZD → x**, so `GBP: 1/300` and `USD: 1/224` at the moment.

---

## 4. Firestore rules

Public reads, owner-only writes. Paste into Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /products/{id} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.token.owner == true;
    }
    match /settings/{id} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.token.owner == true;
    }
  }
}
```

Set the `owner` custom claim on your account once (Firebase Admin SDK, one call),
or swap the condition for `request.auth.uid == 'YOUR_UID'` if you'd rather keep it blunt.

---

## 5. The app side (Android / Kotlin)

Same project, same collection names. Writing a product:

```kotlin
val db = Firebase.firestore

db.collection("products").document(productId)
  .set(mapOf(
    "name"        to name,
    "price"       to priceDzd,          // Long, DZD
    "category"    to category,
    "stock"       to stock,
    "image"       to imageUrl,
    "description" to description,
    "featured"    to featured,
    "active"      to true,
    "updatedAt"   to FieldValue.serverTimestamp(),
  ), SetOptions.merge())
```

Selling an item just decrements the same field:

```kotlin
db.collection("products").document(productId)
  .update("stock", FieldValue.increment(-qty))
```

Editing site copy from the app:

```kotlin
db.collection("settings").document("site")
  .set(mapOf("announcement" to "Free delivery in Annaba this week"), SetOptions.merge())
```

Offline is already handled — the Android SDK queues writes and flushes them when
signal returns. Turn it on with `FirebaseFirestore.getInstance().firestoreSettings =
firestoreSettings { isPersistenceEnabled = true }`.

---

## Notes

- Zero card components anywhere — glass blocks, left-bordered sections and plain tiles only.
- Scroll reveals are reversible; they replay scrolling up as well as down.
- Basket lives in `localStorage` and checks out to WhatsApp. No payment processing.
- Append `?selftest` to the URL and check the console to run the currency-math asserts.
