# Plodroid Store

Customer-facing shop. Static site on GitHub Pages, products read live from Firestore.

Live: **https://plodroid.github.io/store/**

```
index.html           page markup
styles.css           all styling (dark charcoal + selective liquid glass)
app.js               catalogue, search, basket, product dialog, Firestore listeners
firebase-config.js   ← the only file you edit
```

No build step, no packages.

---

## Going live

1. Open `firebase-config.js` and paste your web app config
   (Firebase console → Project settings → Your apps → Web app).
2. Set `whatsapp` in `STORE_DEFAULTS` (or in `settings/site`, below) to turn on ordering
   and the footer contact link. Format: `https://wa.me/44XXXXXXXXXX`.
3. Commit.

Until step 1 is done the site shows **sample products with made-up prices**, labelled
"Sample products and prices shown for preview." Those live in `SAMPLE` at the top of `app.js`
and disappear as soon as Firestore answers.

> The web API key is public by design. Firestore rules protect the data.

---

## Data the app writes

### `products/{id}`

| field | type | notes |
|---|---|---|
| `name` | string | required |
| `price` | number | **GBP, in pounds** — `2.4` shows as £2.40 |
| `category` | string | builds the category tabs automatically |
| `stock` | number | optional. `0` → Sold out, `1–5` → "Only N left". Omit to hide stock entirely |
| `image` | string | optional public URL. Missing or broken → clean lettered placeholder |
| `description` | string | optional, shown in the product dialog |
| `featured` | bool | optional, sorts first under "Featured" |
| `order` | number | optional tiebreaker |
| `active` | bool | `false` hides the product without deleting it |

> Price changed from DZD to GBP in this version — the site is for UK customers and shows £ only.

### `settings/site` (optional)

```json
{
  "storeName": "Plodroid Store",
  "heroTitle": "Everyday essentials,\nall in one place.",
  "heroSubtitle": "Explore food, drinks, groceries and more.",
  "announcement": "",
  "whatsapp": "https://wa.me/44XXXXXXXXXX"
}
```

`announcement` non-empty → thin banner above the nav.

---

## Firestore rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /{col}/{id} {
      allow read: if col in ['products', 'settings'];
      allow write: if request.auth != null && request.auth.uid == 'YOUR_UID';
    }
  }
}
```

## App side (Kotlin)

```kotlin
val db = Firebase.firestore

db.collection("products").document(productId).set(mapOf(
  "name" to name, "price" to priceGbp /* Double, pounds */, "category" to category,
  "stock" to stock, "image" to imageUrl, "description" to description, "active" to true,
), SetOptions.merge())

// a sale
db.collection("products").document(productId).update("stock", FieldValue.increment(-qty))
```

---

## Checks

- Append `?selftest` to the URL and open the console: asserts for GBP formatting, stock parsing,
  filtering, search and sorting.
- `prefers-reduced-motion` turns off every entrance and transition.
