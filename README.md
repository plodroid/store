# Bee Hive

A small shop website (https://plodroid.github.io/store/) on **GitHub Pages + Firebase's free Spark plan**. No card details, no billing, all orders are test orders.

**Shop features:** product pages (big photo, "You may also like", recently viewed), sale prices (owner taps **Sale** on a product), saved items (wishlist, synced to the account), "email me when it's back" on sold-out items (owner taps the **Back in stock** button to email the people waiting), filters and price sorting, My orders.

**Sign-in:** a random 4-digit code is emailed to the customer (sent by a free Google Apps Script from your Gmail), or "Continue with Google". **Owner:** `housikiki@gmail.com`, signing in with Google, gets a **Manage** button.

---

## Setup, step by step

Time: about 15 minutes. You need to be signed in to Google as **housikiki@gmail.com** for all of it.

### 1. Check Google sign-in is on (already done for `asimsstore`)
Firebase console → **Authentication → Sign-in method** → **Google** = Enabled.
**Settings → Authorized domains** has `plodroid.github.io`.

Optional: switch **Email/Password** off there. The site doesn't use passwords any more.

### 2. Publish the security rules
1. Firebase console → **Firestore Database → Rules**.
2. Delete everything in the editor and paste the whole of [`firestore.rules`](firestore.rules).
3. Click **Publish**.

Do this *before* step 7, otherwise new logins can't read or write anything.

### 3. Download your Firebase service-account key
It lets the script mint a login for someone who typed the right code. Treat it like a password.
1. Firebase console → ⚙ **Project settings → Service accounts**.
2. **Generate new private key** → confirm → a `.json` file downloads.
3. Keep it private. **Never** put it in GitHub, the website, or a chat.

### 4. Create the Apps Script
1. Go to https://script.google.com → **New project**. Name it `store-login`.
2. Delete the default code and paste the whole of [`apps-script/Code.gs`](apps-script/Code.gs).
3. Change `STORE_NAME` at the top if you want. Save (Ctrl+S).

### 5. Give the script the key
1. In the script editor: ⚙ **Project settings → Script properties → Add script property**. Add two:

   | Property | Value |
   |---|---|
   | `FB_CLIENT_EMAIL` | `client_email` from the JSON file (looks like `firebase-adminsdk-xxxx@asimsstore.iam.gserviceaccount.com`) |
   | `FB_PRIVATE_KEY` | `private_key` from the JSON file: everything from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----`, without the surrounding quotes. The `\n` pieces are fine as they are. |

2. **Save script properties.**
3. Delete the downloaded JSON from your computer once it's saved.

### 6. Authorise and test
1. In the editor pick the function **`checkSetup`** → **Run**.
2. Google asks for permission → **Review permissions** → pick housikiki@gmail.com → *"Google hasn't verified this app"* → **Advanced → Go to store-login (unsafe)** → **Allow**. (It's your own script; it only needs "send email as you".)
3. The log should say the key works and the email limit left. If it says a property is missing, redo step 5.

### 7. Deploy it as a web app
1. **Deploy → New deployment** → ⚙ type **Web app**.
2. *Execute as:* **Me**. *Who has access:* **Anyone**.
3. **Deploy** → copy the **Web app URL** (starts with `https://script.google.com/macros/s/…/exec`).

### 8. Put the URL in the site
In the repo edit [`firebase-config.js`](firebase-config.js):

```js
window.STORE_AUTH_URL = "https://script.google.com/macros/s/XXXX/exec";
```

Commit and push to `main`. GitHub Pages can take up to ~10 minutes to show it (hard refresh: Ctrl+Shift+R).

### 9. Try it
1. Open the site → **Sign in** → type any *other* email you own → **Send code** → check that inbox (and spam the first time) → type the 4 digits. You're in.
2. Sign out, **Sign in → Continue with Google** with housikiki@gmail.com. **Manage** appears top left. That's the owner panel.

Done. 🎉

---

## How it behaves

- **Owner:** the rules treat `housikiki@gmail.com` as owner only when signed in with **Google** and the email is verified. A 4-digit code can never make someone the owner, and the script refuses to send a code to that address.
- **To change the owner:** edit the email in three places: `firestore.rules` (`isOwner()`), `apps-script/Code.gs` (`GOOGLE_ONLY`), then re-publish the rules and re-deploy the script (step 10).
- **Code rules:** valid for 10 minutes, resend after 30 seconds, 3 wrong tries kills the code, 6 wrong guesses in an hour locks that email for the hour, 5 codes per email per hour. All adjustable in `SETTINGS` at the top of `Code.gs`.
- **Google vs code accounts are separate.** The same person signing in once with a code and once with Google gets two accounts (two profiles, order histories).
- **Theme:** warm white `#F4F3EE` by default, the moon/sun button switches to dark and the choice is remembered on that device.

## Limits of the free plan (on purpose)

- **Emails:** a normal Gmail can send about **100 a day**, so the script stops at 80 sign-in codes a day. After that people can still use Google sign-in. A shop with real traffic should move to a proper email sender later.
- 4 digits is weak by nature. The limits above are what make it acceptable. Anything that handles real money should use something stronger.
- The Apps Script URL is public (it has to be). It only sends codes and checks them; it can't read your shop data.
- `housikiki@gmail.com` is visible in the public repo (rules file). That's fine: the email alone gives no access.
- A postcode is checked to be real; the street/house number can't be verified for free.
- No push notifications when the site is closed. Alerts (sound, toast, desktop notification) work while the page is open.
- Prices/stock aren't enforced at order time: orders hold product ids and quantities, and the owner's **Confirm** locks prices and takes stock. Overselling is possible until then.
- Product photos are stored inside Firestore (shrunk to ≤ ~55 KB) because Storage needs a paid plan.
- Rate limits: one order per 30 s and one message per 60 s per customer.

## Step 10: changing the script later
Editing `Code.gs` does nothing until you redeploy: **Deploy → Manage deployments → ✏ edit → Version: New version → Deploy**. The URL stays the same.

## Step 11: card payments with Stripe (optional)

Orders are still placed first and confirmed by the shop (that locks the price). Once an order is **Confirmed**, the customer sees **Pay £x by card** under it in *My orders*. They can also just pay at pick-up or on delivery. The card is charged on Stripe's own page, so no card details ever touch this site.

1. Make a free account at <https://dashboard.stripe.com/register> (the shop owner's own account). Stay in **Test mode** (the switch at the top) until you've tried it.
2. In Stripe: **Developers → API keys**. Copy the **Secret key** (starts with `sk_test_`). Never paste it anywhere public.
3. In the Apps Script: **Project Settings (the cog) → Script properties → Add script property**. Name `STRIPE_SECRET_KEY`, value = the key. Save.
4. Redeploy (Step 10): **Deploy → Manage deployments → pencil → Version: New version → Deploy**.
5. Test: place an order, confirm it as the owner, open *My orders* as the customer, press **Pay**, use card `4242 4242 4242 4242`, any future date, any CVC. You come back to the shop, the order shows **Paid**, and the owner sees **Paid** on it.
6. Going live: in Stripe turn Test mode off, finish Stripe's business details, copy the **live** secret key (`sk_live_`) and replace the script property in step 3, then redo step 4.

If the key is missing, the Pay button simply doesn't appear. The amount always comes from the confirmed order on the server, and an order is only marked paid after the script asks Stripe itself whether it was paid.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Email sign-in isn't set up yet" | `STORE_AUTH_URL` in `firebase-config.js` is still the placeholder, or the push hasn't gone live yet (wait ~10 min). |
| Code never arrives | Check spam. Run `checkSetup` and look at the email quota in the log. After 80 codes a day it pauses until tomorrow. |
| "Something went wrong" after typing the right code | The script properties are wrong. Run `checkSetup`; re-copy `FB_CLIENT_EMAIL` and `FB_PRIVATE_KEY` from the JSON. |
| Signed in but orders/feedback fail with permission errors | Rules weren't published (step 2) or are an old copy. |
| No **Manage** button | You must sign in with **Google** as housikiki@gmail.com (not a code), and the rules must be published. |
| Google popup blocked / "unauthorized domain" | Allow popups for the site; check `plodroid.github.io` is in Authorized domains (step 1). |
| Script says "Authorization required" when the site calls it | Re-run `checkSetup` once to authorise, then do step 10. |

## Files

| File | What |
|---|---|
| `index.html`, `styles.css`, `app.js` | the shop |
| `auth.js`, `uk.js`, `ui.js` | login (email code + Google), UK postcode/phone helpers, shared UI bits |
| `admin.js`, `admin.css` | owner panel (loaded only for the owner) |
| `firebase-config.js` | public web config + the Apps Script URL (safe to commit; the rules are the security) |
| `firestore.rules` | security rules |
| `apps-script/Code.gs` | the free email-code service (lives in your Google account, not on the website) |
| `test/` | `node --test test/*.test.mjs` (unit + Apps Script logic) and `node test/e2e/flows.mjs`, `node test/e2e/admin.mjs`, `node test/e2e/features.mjs` (browser tests against a fake Firebase; needs Playwright) |
| `functions/`, `android/`, `.github/workflows/android-apk.yml` | **legacy** Blaze-plan backend and owner Android app. Not used by the website. |

## Developing
Open `index.html` through any static server. `?preview` shows sample data when `firebase-config.js` has placeholders.
