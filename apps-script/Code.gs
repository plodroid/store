/**
 * Store sign-in codes (Google Apps Script). Setup: README.md, step 5.
 *
 * What it does
 *   send   {email}        -> emails a random 4-digit code to that address
 *   verify {email, code}  -> if the code is right, returns a Firebase sign-in token for that email
 *
 * Why it exists: Firebase can't email 4-digit codes on the free plan. This script runs free in your
 * Google account, sends the emails from your Gmail, and signs the Firebase token with your project's
 * service-account key (stored in Script properties, never in the website).
 */

const SETTINGS = {
  STORE_NAME: 'Plodroid Store',
  CODE_MINUTES: 10,          // a code stops working after this long
  RESEND_SECONDS: 30,        // gap between two codes for the same email
  TRIES_PER_CODE: 3,         // wrong guesses before a code is thrown away
  FAILS_PER_HOUR: 6,         // wrong guesses per email per hour, across all its codes
  SENDS_PER_HOUR: 5,         // codes per email per hour
  SENDS_PER_DAY: 80,         // codes for the whole shop per day (a free Gmail can send about 100 emails a day)
  GOOGLE_ONLY: ['housikiki@gmail.com'],   // these emails must use "Continue with Google" (a 4-digit code is too weak for the owner)
};

/* ── web app entry points ─────────────────────────────── */

function doGet() { return out_({ ok: true, service: 'store-login' }); }

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, error: 'bad_request' }); }
  const email = String((body && body.email) || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return out_({ ok: false, error: 'bad_email' });

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (x) { return out_({ ok: false, error: 'server' }); }
  try {
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

/* ── send / verify ────────────────────────────────────── */

function send_(email) {
  if (SETTINGS.GOOGLE_ONLY.indexOf(email) >= 0) return { ok: false, error: 'use_google' };
  const c = CacheService.getScriptCache(), now = Date.now();

  const sends = getJson_(c, key_('s', email)) || { n: 0, t0: now, last: 0 };
  if (now - sends.t0 > 3600e3) { sends.n = 0; sends.t0 = now; }
  const gap = SETTINGS.RESEND_SECONDS * 1000 - (now - sends.last);
  if (gap > 0) return { ok: false, error: 'wait', wait: Math.ceil(gap / 1000) };
  if (sends.n >= SETTINGS.SENDS_PER_HOUR) return { ok: false, error: 'limit' };
  if (dayCount_() >= SETTINGS.SENDS_PER_DAY) return { ok: false, error: 'busy' };

  const code = newCode_();
  const entry = { h: hash_(email, code), tries: 0, exp: now + SETTINGS.CODE_MINUTES * 60e3 };
  c.put(key_('c', email), JSON.stringify(entry), SETTINGS.CODE_MINUTES * 60);
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
    c.remove(key_('c', email));
    return { ok: false, error: 'send_failed' };
  }
  sends.n++; sends.last = now;
  c.put(key_('s', email), JSON.stringify(sends), 3600);
  bumpDay_();
  return { ok: true };
}

function verify_(email, code) {
  if (!/^\d{4}$/.test(code)) return { ok: false, error: 'bad_code' };
  if (SETTINGS.GOOGLE_ONLY.indexOf(email) >= 0) return { ok: false, error: 'use_google' };
  const c = CacheService.getScriptCache(), now = Date.now();

  const fails = getJson_(c, key_('f', email)) || { n: 0, t0: now };
  if (now - fails.t0 > 3600e3) { fails.n = 0; fails.t0 = now; }
  if (fails.n >= SETTINGS.FAILS_PER_HOUR) return { ok: false, error: 'locked' };

  const entry = getJson_(c, key_('c', email));
  if (!entry || now > entry.exp) return { ok: false, error: 'expired' };

  if (entry.h !== hash_(email, code)) {
    entry.tries++; fails.n++;
    c.put(key_('f', email), JSON.stringify(fails), 3600);
    if (entry.tries >= SETTINGS.TRIES_PER_CODE) { c.remove(key_('c', email)); return { ok: false, error: 'expired' }; }
    c.put(key_('c', email), JSON.stringify(entry), Math.max(1, Math.ceil((entry.exp - now) / 1000)));
    return { ok: false, error: 'bad_code', left: SETTINGS.TRIES_PER_CODE - entry.tries };
  }
  c.remove(key_('c', email));                 // a code works once
  return { ok: true, token: token_(email) };
}

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
    uid: 'e_' + hex_(sha256_(email)),                 // the same email always gets the same account
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
