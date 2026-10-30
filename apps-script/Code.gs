/**
 * Bee Hive sign-in codes + back-in-stock emails (Google Apps Script). Setup: README.md, step 5.
 *
 * What it does
 *   send   {email}        -> emails a random 4-digit code to that address
 *   verify {email, code}  -> if the code is right, returns a Firebase sign-in token for that email
 *   notify {idToken, product, link, emails} -> owner only: emails customers that a product is back in stock
 *   pay    {idToken, orderId}   -> a customer's own confirmed order: returns a Stripe Checkout link for its total
 *   paid   {idToken, orderId, sid} -> after Stripe sends the customer back: checks the payment with Stripe, marks the order paid
 *
 * Why it exists: Firebase can't email 4-digit codes on the free plan. This script runs free in your
 * Google account, sends the emails from your Gmail, and signs the Firebase token with your project's
 * service-account key (stored in Script properties, never in the website).
 */

const SETTINGS = {
  STORE_NAME: 'Bee Hive',
  SITE_URL: 'https://plodroid.github.io/store/',   // notify emails may only link here
  FIREBASE_API_KEY: 'AIzaSyAyEC7cTlTsNibzK7zVFm3NTds1ezcJDa0',   // the public web key from firebase-config.js (used to check the owner's login)
  CODE_MINUTES: 10,          // a code stops working after this long
  RESEND_SECONDS: 30,        // gap between two codes for the same email
  TRIES_PER_CODE: 3,         // wrong guesses before a code is thrown away
  FAILS_PER_HOUR: 6,         // wrong guesses per email per hour, across all its codes
  SENDS_PER_HOUR: 5,         // codes per email per hour
  SENDS_PER_DAY: 80,         // codes for the whole shop per day (a free Gmail can send about 100 emails a day)
  GOOGLE_ONLY: ['housikiki@gmail.com'],   // these emails must use "Continue with Google" (a 4-digit code is too weak for the owner)
  NOTIFY_MAX: 40,            // customers per back-in-stock send
  PROJECT_ID: 'asimsstore',  // Firebase project (orders are read and marked paid here)
};

/* ── web app entry points ─────────────────────────────── */

function doGet() { return out_({ ok: true, service: 'store-login', pay: !!stripeKey_() }); }

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, error: 'bad_request' }); }
  if (!body || typeof body !== 'object') return out_({ ok: false, error: 'bad_request' });

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (x) { return out_({ ok: false, error: 'server' }); }
  try {
    if (body.a === 'notify') return out_(notify_(body));
    if (body.a === 'pay') return out_(pay_(body));
    if (body.a === 'paid') return out_(paid_(body));
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return out_({ ok: false, error: 'bad_email' });
    if (body.a === 'send') return out_(send_(email));
    if (body.a === 'verify') return out_(verify_(email, String(body.code || '')));
    return out_({ ok: false, error: 'bad_request' });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

/** Gmail ignores dots and "+tags", so name+x@gmail.com and n.ame@gmail.com are the same person. */
function canonical_(email) {
  const p = String(email).toLowerCase().split('@');
  if (p[1] === 'gmail.com' || p[1] === 'googlemail.com') return p[0].split('+')[0].replace(/\./g, '') + '@gmail.com';
  return p.join('@');
}
function googleOnly_(email) {
  const c = canonical_(email);
  return SETTINGS.GOOGLE_ONLY.some(function (g) { return canonical_(g) === c; });
}

/* ── send / verify ────────────────────────────────────── */

function send_(email) {
  if (googleOnly_(email)) return { ok: false, error: 'use_google' };
  const c = CacheService.getScriptCache(), now = Date.now(), id = canonical_(email);   // limits follow the person, not the alias

  const sends = getJson_(c, key_('s', id)) || { n: 0, t0: now, last: 0 };
  if (now - sends.t0 > 3600e3) { sends.n = 0; sends.t0 = now; }
  const gap = SETTINGS.RESEND_SECONDS * 1000 - (now - sends.last);
  if (gap > 0) return { ok: false, error: 'wait', wait: Math.ceil(gap / 1000) };
  if (sends.n >= SETTINGS.SENDS_PER_HOUR) return { ok: false, error: 'limit' };
  if (dayCount_() >= SETTINGS.SENDS_PER_DAY) return { ok: false, error: 'busy' };

  const code = newCode_();
  const entry = { h: hash_(id, code), tries: 0, exp: now + SETTINGS.CODE_MINUTES * 60e3 };
  c.put(key_('c', id), JSON.stringify(entry), SETTINGS.CODE_MINUTES * 60);
  try {
    MailApp.sendEmail({
      to: email,
      name: SETTINGS.STORE_NAME,
      subject: code + ' is your ' + SETTINGS.STORE_NAME + ' sign-in code',
      body: 'Your sign-in code is ' + code + '.\n\nIt works for ' + SETTINGS.CODE_MINUTES + ' minutes. ' +
            "If you didn't ask for it, ignore this email. Nobody can sign in without the code.",
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:420px">' +
                '<p style="margin:0 0 12px">Your sign-in code for <b>' + SETTINGS.STORE_NAME + '</b>:</p>' +
                '<p style="margin:0 0 16px;font-size:34px;letter-spacing:8px;font-weight:700">' + code + '</p>' +
                '<p style="margin:0;color:#666;font-size:13px">It works for ' + SETTINGS.CODE_MINUTES + " minutes. If you didn't ask for it, " +
                'ignore this email. Nobody can sign in without the code.</p></div>',
    });
  } catch (err) {
    console.error(err);
    c.remove(key_('c', id));
    return { ok: false, error: 'send_failed' };
  }
  sends.n++; sends.last = now;
  c.put(key_('s', id), JSON.stringify(sends), 3600);
  bumpDay_();
  return { ok: true };
}

function verify_(email, code) {
  if (!/^\d{4}$/.test(code)) return { ok: false, error: 'bad_code' };
  if (googleOnly_(email)) return { ok: false, error: 'use_google' };
  const c = CacheService.getScriptCache(), now = Date.now(), id = canonical_(email);

  const fails = getJson_(c, key_('f', id)) || { n: 0, t0: now };
  if (now - fails.t0 > 3600e3) { fails.n = 0; fails.t0 = now; }
  if (fails.n >= SETTINGS.FAILS_PER_HOUR) return { ok: false, error: 'locked' };

  const entry = getJson_(c, key_('c', id));
  if (!entry || now > entry.exp) return { ok: false, error: 'expired' };

  if (entry.h !== hash_(id, code)) {
    entry.tries++; fails.n++;
    c.put(key_('f', id), JSON.stringify(fails), 3600);
    if (entry.tries >= SETTINGS.TRIES_PER_CODE) { c.remove(key_('c', id)); return { ok: false, error: 'expired' }; }
    c.put(key_('c', id), JSON.stringify(entry), Math.max(1, Math.ceil((entry.exp - now) / 1000)));
    return { ok: false, error: 'bad_code', left: SETTINGS.TRIES_PER_CODE - entry.tries };
  }
  c.remove(key_('c', id));                    // a code works once
  return { ok: true, token: token_(email) };
}

/* ── back-in-stock emails (owner only) ───────────────── */

/** True only when the Firebase login token belongs to a Google-verified owner address. */
function ownerOf_(idToken) {
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + SETTINGS.FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return false;
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u || u.emailVerified !== true) return false;
  const viaGoogle = (u.providerUserInfo || []).some(function (p) { return p.providerId === 'google.com'; });
  return viaGoogle && SETTINGS.GOOGLE_ONLY.indexOf(String(u.email || '').toLowerCase()) >= 0;
}

function notify_(b) {
  const idToken = String(b.idToken || ''), product = String(b.product || '').trim().slice(0, 120), link = String(b.link || '');
  const seen = {}, emails = (Array.isArray(b.emails) ? b.emails : []).map(function (x) { return String(x).trim().toLowerCase(); })
    .filter(function (x) { if (seen[x] || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) || x.length > 120) return false; return (seen[x] = true); })
    .slice(0, SETTINGS.NOTIFY_MAX);
  if (!idToken || !product || link.indexOf(SETTINGS.SITE_URL) !== 0 || link.length > 300 || !emails.length) return { ok: false, error: 'bad_request' };
  if (!ownerOf_(idToken)) return { ok: false, error: 'not_owner' };

  const sentTo = [];
  for (let i = 0; i < emails.length; i++) {
    if (dayCount_() >= SETTINGS.SENDS_PER_DAY) break;
    try {
      MailApp.sendEmail({
        to: emails[i], name: SETTINGS.STORE_NAME,
        subject: product + ' is back in stock at ' + SETTINGS.STORE_NAME,
        body: 'Good news: ' + product + ' is back in stock.\n\n' + link + '\n\nYou asked us to tell you. This is the only email you will get about it.',
        htmlBody: '<div style="font-family:Arial,sans-serif;max-width:420px"><p style="margin:0 0 12px">Good news: <b>' + esc_(product) + '</b> is back in stock.</p>' +
                  '<p style="margin:0 0 16px"><a href="' + esc_(link) + '" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#1A6CE0;color:#fff;text-decoration:none">View it in the shop</a></p>' +
                  '<p style="margin:0;color:#666;font-size:13px">You asked us to tell you. This is the only email you will get about it.</p></div>',
      });
      bumpDay_(); sentTo.push(emails[i]);
    } catch (err) { console.error(err); }
  }
  if (!sentTo.length) return { ok: false, error: dayCount_() >= SETTINGS.SENDS_PER_DAY ? 'busy' : 'server' };
  return { ok: true, sent: sentTo.length, sentTo: sentTo };
}
function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ── card payments (Stripe Checkout) ─────────────────────
   The secret key lives only in Script properties (STRIPE_SECRET_KEY). Amounts always come from the order in
   Firestore, never from the browser, and "paid" is only written after Stripe itself says so. */

function stripeKey_() { return PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY') || ''; }

/** The Firebase account behind a login token, or null. */
function user_(idToken) {
  if (!idToken) return null;
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + SETTINGS.FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: String(idToken) }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  return u && u.localId ? { uid: u.localId, email: u.email || '' } : null;
}

function stripe_(method, path, form) {
  const opts = { method: method, headers: { Authorization: 'Basic ' + Utilities.base64Encode(stripeKey_() + ':') }, muteHttpExceptions: true };
  if (form) opts.payload = form;
  const res = UrlFetchApp.fetch('https://api.stripe.com' + path, opts);
  const j = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 300) throw new Error('Stripe: ' + ((j.error && j.error.message) || res.getResponseCode()));
  return j;
}

function orderId_(v) { const id = String(v || ''); return /^o_[A-Za-z0-9_-]{6,60}$/.test(id) ? id : ''; }

function pay_(b) {
  if (!stripeKey_()) return { ok: false, error: 'not_set_up' };
  const u = user_(b.idToken), id = orderId_(b.orderId);
  if (!u || !id) return { ok: false, error: 'auth' };
  const o = order_(id);
  if (!o || o.uid !== u.uid) return { ok: false, error: 'not_found' };
  if (o.paymentStatus === 'paid') return { ok: false, error: 'already_paid' };
  if (['confirmed', 'preparing', 'ready'].indexOf(o.status) < 0 || !(Number(o.total) > 0)) return { ok: false, error: 'not_ready' };
  const form = {
    mode: 'payment', client_reference_id: id,
    success_url: SETTINGS.SITE_URL + '?paid=' + id + '&sid={CHECKOUT_SESSION_ID}',
    cancel_url: SETTINGS.SITE_URL + '?paycancel=1',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'gbp',
    'line_items[0][price_data][unit_amount]': String(Math.round(Number(o.total) * 100)),
    'line_items[0][price_data][product_data][name]': SETTINGS.STORE_NAME + ' order ' + String(o.ref || ''),
    'metadata[order_id]': id, 'payment_intent_data[description]': SETTINGS.STORE_NAME + ' order ' + String(o.ref || ''),
  };
  if (u.email) form.customer_email = u.email;
  return { ok: true, url: stripe_('post', '/v1/checkout/sessions', form).url };
}

function paid_(b) {
  if (!stripeKey_()) return { ok: false, error: 'not_set_up' };
  const u = user_(b.idToken), id = orderId_(b.orderId), sid = String(b.sid || '');
  if (!u || !id || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return { ok: false, error: 'auth' };
  const o = order_(id);
  if (!o || o.uid !== u.uid) return { ok: false, error: 'not_found' };
  if (o.paymentStatus === 'paid') return { ok: true, already: true };
  const s = stripe_('get', '/v1/checkout/sessions/' + sid);
  if (s.payment_status !== 'paid' || s.client_reference_id !== id || s.currency !== 'gbp' || s.amount_total !== Math.round(Number(o.total) * 100)) {
    return { ok: false, error: 'not_paid' };
  }
  const now = new Date().toISOString();
  firestore_('patch', 'orders/' + id, {
    paymentStatus: { stringValue: 'paid' }, paymentMethod: { stringValue: 'card' }, stripeSession: { stringValue: sid },
    paidAt: { timestampValue: now }, updatedAt: { timestampValue: now },
  });
  return { ok: true };
}

/* Firestore over REST, signed in as the service account (so the security rules don't apply to this script) */

function accessToken_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('fs_token');
  if (hit) return hit;
  const p = PropertiesService.getScriptProperties();
  const clientEmail = p.getProperty('FB_CLIENT_EMAIL'), privateKey = (p.getProperty('FB_PRIVATE_KEY') || '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const input = b64u_(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u_(JSON.stringify({
    iss: clientEmail, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3300 }));
  const jwt = input + '.' + Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(input, privateKey)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt } });
  const j = JSON.parse(res.getContentText());
  if (!j.access_token) throw new Error('Google token: ' + (j.error_description || j.error || res.getResponseCode()));
  cache.put('fs_token', j.access_token, 3000);
  return j.access_token;
}

function firestore_(method, path, fields) {
  let url = 'https://firestore.googleapis.com/v1/projects/' + SETTINGS.PROJECT_ID + '/databases/(default)/documents/' + path;
  const opts = { method: method, headers: { Authorization: 'Bearer ' + accessToken_() }, muteHttpExceptions: true };
  if (fields) {
    url += '?currentDocument.exists=true&' + Object.keys(fields).map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&');
    opts.contentType = 'application/json'; opts.payload = JSON.stringify({ fields: fields });
  }
  const res = UrlFetchApp.fetch(url, opts);
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() >= 300) throw new Error('Firestore ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

function fsValue_(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.mapValue) return fsFields_(v.mapValue.fields || {});
  if (v.arrayValue) return (v.arrayValue.values || []).map(fsValue_);
  return null;
}
function fsFields_(f) { const o = {}; Object.keys(f).forEach(function (k) { o[k] = fsValue_(f[k]); }); return o; }
function order_(id) { const d = firestore_('get', 'orders/' + id); return d ? fsFields_(d.fields || {}) : null; }

/* ── Firebase custom token (RS256 JWT signed with the service-account key) ── */

function token_(email) {
  const p = PropertiesService.getScriptProperties();
  const clientEmail = p.getProperty('FB_CLIENT_EMAIL');
  const privateKey = (p.getProperty('FB_PRIVATE_KEY') || '').replace(/\\n/g, '\n');
  if (!clientEmail || privateKey.indexOf('BEGIN PRIVATE KEY') < 0) throw new Error('FB_CLIENT_EMAIL / FB_PRIVATE_KEY are not set in Script properties');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail, sub: clientEmail,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3300,
    uid: 'e_' + hex_(sha256_(canonical_(email))),     // the same person always gets the same account
    claims: { mail: email, cv: true },                // cv = "code verified": the security rules treat this as a verified email
  };
  const input = b64u_(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u_(JSON.stringify(payload));
  return input + '.' + Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(input, privateKey)).replace(/=+$/, '');
}

/* ── helpers ──────────────────────────────────────────── */

function newCode_() {
  const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 8);      // 32 random bits from a secure source
  return ('000' + (parseInt(hex, 16) % 10000)).slice(-4);
}
function pepper_() {
  const p = PropertiesService.getScriptProperties();
  let v = p.getProperty('PEPPER');
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('PEPPER', v); }
  return v;
}
function sha256_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8); }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function hash_(email, code) { return hex_(sha256_(pepper_() + '|' + email + '|' + code)); }
function key_(kind, email) { return kind + hex_(sha256_(pepper_() + '|' + email)).slice(0, 40); }
function b64u_(s) { return Utilities.base64EncodeWebSafe(s, Utilities.Charset.UTF_8).replace(/=+$/, ''); }
function getJson_(cache, k) { const v = cache.get(k); return v ? JSON.parse(v) : null; }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function dayKey_() { return 'day_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd'); }
function dayCount_() { return Number(PropertiesService.getScriptProperties().getProperty(dayKey_()) || 0); }
function bumpDay_() {
  const p = PropertiesService.getScriptProperties(), k = dayKey_();
  p.setProperty(k, String(dayCount_() + 1));
  p.getKeys().forEach(function (x) { if (x.indexOf('day_') === 0 && x !== k) p.deleteProperty(x); });
}

/**
 * Run this once from the editor (Run > checkSetup). It asks Google for permission to send email, then
 * checks that the Firebase key in Script properties can sign a token. Look for "Setup OK" in the log.
 */
function checkSetup() {
  Logger.log('Emails you can still send today: ' + MailApp.getRemainingDailyQuota());
  const t = token_('check@example.com');
  Logger.log('Setup OK. Test token starts: ' + t.slice(0, 20) + '...');
}
