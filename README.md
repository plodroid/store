# Plodroid Store

A small shop website (https://plodroid.github.io/store/) on **GitHub Pages + Firebase's free Spark plan**. No server code, no card details, no billing.

## What it does
- **Customers**: browse, sign up / sign in (email or Google), verify email, save a UK location (postcode checked with postcodes.io), order for **pickup or delivery**, send feedback / bug reports.
- **Owner**: signs in with their own account and gets a **Manage** button (top left) to run the shop: products, categories, orders, feedback and settings. Alerts (sound, toast, desktop notification) work while the page is open.
- All orders are **test orders**: no payment is taken.

## Files
| File | What |
|---|---|
| `index.html`, `styles.css`, `app.js` | the shop |
| `auth.js`, `uk.js`, `ui.js` | accounts, UK postcode/phone helpers, shared UI bits |
| `admin.js`, `admin.css` | owner panel (loaded only for the owner) |
| `firebase-config.js` | public web config (safe to commit; the rules are the security) |
| `firestore.rules` | security rules: paste into Firebase console → Firestore → Rules → Publish |
| `test/` | `node --test test/*.test.mjs` (unit) and `node test/e2e/flows.mjs`, `node test/e2e/admin.mjs` (browser tests against a fake Firebase; needs Playwright) |
| `functions/`, `android/`, `.github/workflows/android-apk.yml` | **legacy** Blaze-plan backend and owner Android app. Not used by the website. |

## Setup (done for project `asimsstore`)
1. Firebase console → Authentication → enable **Email/Password** and **Google**; Settings → Authorized domains → add `plodroid.github.io`.
2. Firestore → Rules → paste `firestore.rules` → Publish.
3. **Make an owner**: sign in on the site once with the owner's account, then Authentication → Users → copy that account's *User UID*. Firestore → Data → start collection `owners` → document ID = that UID, any field (e.g. `createdAt`). Only the console can create owners.
4. Sign in again: **Manage** appears.

## Limits of the free plan (on purpose)
- Email verification is a **link**, not a 4-digit code (codes need a server).
- Apple sign-in needs a paid Apple Developer account, so the button is disabled.
- A postcode is checked to be real; the house number/street can't be verified for free.
- No push notifications when the site is closed. A WhatsApp/Telegram bot needs a free Cloudflare Worker or the paid Blaze plan.
- The server can't enforce prices/stock at order time: orders hold product ids + quantities, and the owner's **Confirm** locks prices and takes stock in a transaction. Overselling is possible until then.
- Product photos are stored inside Firestore (shrunk to ≤ ~55 KB) because Storage needs Blaze.
- Rate limits: one order per 30 s and one message per 60 s per customer (enforced by the rules).

## Developing
Open `index.html` through any static server. `?preview` shows sample data when `firebase-config.js` has placeholders. The previous (longer) README is in git history.
