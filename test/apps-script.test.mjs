// Runs apps-script/Code.gs against stand-ins for the Google services, with real RSA signing,
// so the sign-in logic and the token format are checked without a Google account.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import crypto from "node:crypto";

const SRC = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const signed = buf => [...buf].map(b => (b > 127 ? b - 256 : b));    // Apps Script returns signed bytes
const bytes = x => (typeof x === "string" ? Buffer.from(x, "utf8") : Buffer.from(x.map(b => b & 255)));

function world(props = {}, lookup = null) {
  const clock = { now: 1_800_000_000_000 };
  const mails = [];
  const store = new Map();
  const cache = {
    get: k => { const e = store.get(k); return e && e.exp > clock.now ? e.v : null; },
    put: (k, v, ttl) => store.set(k, { v, exp: clock.now + ttl * 1000 }),
    remove: k => store.delete(k),
  };
  const P = { FB_CLIENT_EMAIL: "svc@proj.iam.gserviceaccount.com", FB_PRIVATE_KEY: PEM.replace(/\n/g, "\\n"), ...props };
  class FakeDate extends Date {
    constructor(...a) { a.length ? super(...a) : super(clock.now); }
    static now() { return clock.now; }
  }
  const ctx = vm.createContext({
    console, Math, JSON, parseInt, Number, String, Date: FakeDate,
    Utilities: {
      Charset: { UTF_8: "utf8" }, DigestAlgorithm: { SHA_256: "sha256" },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_, s) => signed(crypto.createHash("sha256").update(s).digest()),
      computeRsaSha256Signature: (input, key) => signed(crypto.sign("RSA-SHA256", Buffer.from(input), key)),
      base64EncodeWebSafe: x => bytes(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),   // padded, like the real one
      formatDate: d => d.toISOString().slice(0, 10).replace(/-/g, ""),
    },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in P ? P[k] : null), setProperty: (k, v) => { P[k] = v; },
      getKeys: () => Object.keys(P), deleteProperty: k => { delete P[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: m => mails.push(m), getRemainingDailyQuota: () => 100 },
    // stand-in for Google's token lookup: `lookup` maps an idToken to the account it belongs to
    UrlFetchApp: { fetch: (url, opts) => {
      const u = lookup && lookup[JSON.parse(opts.payload).idToken];
      return { getResponseCode: () => (u ? 200 : 400), getContentText: () => JSON.stringify({ users: u ? [u] : [] }) };
    } },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    Logger: { log() {} },
  });
  vm.runInContext(SRC, ctx);
  const call = body => JSON.parse(vm.runInContext("doPost", ctx)({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).s);
  const codeOf = i => mails[i].body.match(/code is (\d{4})\./)[1];
  return { clock, mails, call, ctx, props: P, codeOf };
}
const wrong = c => (c === "0000" ? "1111" : "0000");

test("send emails a 4-digit code and never returns it", () => {
  const w = world();
  const r = w.call({ a: "send", email: "Gina@Example.com " });
  assert.deepEqual(r, { ok: true });
  assert.equal(w.mails.length, 1);
  assert.equal(w.mails[0].to, "gina@example.com");
  assert.match(w.mails[0].subject, /^\d{4} is your Bee Hive sign-in code$/);
  assert.match(w.mails[0].htmlBody, /\d{4}/);
});

test("right code returns a Firebase custom token that verifies against the public key", () => {
  const w = world();
  w.call({ a: "send", email: "gina@example.com" });
  const r = w.call({ a: "verify", email: "gina@example.com", code: w.codeOf(0) });
  assert.equal(r.ok, true);
  const [h, p, s] = r.token.split(".");
  assert.ok(!r.token.includes("=") && !/[+/]/.test(r.token));
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "RS256", typ: "JWT" });
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url")), "signature");
  const c = JSON.parse(Buffer.from(p, "base64url"));
  assert.equal(c.iss, "svc@proj.iam.gserviceaccount.com"); assert.equal(c.sub, c.iss);
  assert.equal(c.aud, "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit");
  assert.match(c.uid, /^e_[0-9a-f]{64}$/);
  assert.deepEqual(c.claims, { mail: "gina@example.com", cv: true });
  assert.ok(c.exp - c.iat <= 3600 && c.iat === Math.floor(w.clock.now / 1000));
});

test("same email -> same uid; different email -> different uid", () => {
  const uid = (w, e) => { w.call({ a: "send", email: e }); w.clock.now += 31e3;
    const t = w.call({ a: "verify", email: e, code: w.codeOf(w.mails.length - 1) }).token; return JSON.parse(Buffer.from(t.split(".")[1], "base64url")).uid; };
  const w = world();
  assert.equal(uid(w, "a@b.co"), uid(w, "a@b.co"));
  assert.notEqual(uid(w, "a@b.co"), uid(w, "c@d.co"));
});

test("a code works once", () => {
  const w = world();
  w.call({ a: "send", email: "a@b.co" });
  const code = w.codeOf(0);
  assert.equal(w.call({ a: "verify", email: "a@b.co", code }).ok, true);
  assert.equal(w.call({ a: "verify", email: "a@b.co", code }).error, "expired");
});

test("wrong codes count down, then the code is thrown away", () => {
  const w = world();
  w.call({ a: "send", email: "a@b.co" });
  const bad = wrong(w.codeOf(0));
  assert.deepEqual(w.call({ a: "verify", email: "a@b.co", code: bad }), { ok: false, error: "bad_code", left: 2 });
  assert.deepEqual(w.call({ a: "verify", email: "a@b.co", code: bad }), { ok: false, error: "bad_code", left: 1 });
  assert.equal(w.call({ a: "verify", email: "a@b.co", code: bad }).error, "expired");
  assert.equal(w.call({ a: "verify", email: "a@b.co", code: w.codeOf(0) }).error, "expired", "even the right code is dead now");
});

test("6 wrong guesses in an hour lock the email, even across new codes", () => {
  const w = world();
  for (let round = 0; round < 2; round++) {
    w.call({ a: "send", email: "a@b.co" }); w.clock.now += 31e3;
    const bad = wrong(w.codeOf(w.mails.length - 1));
    for (let i = 0; i < 3; i++) w.call({ a: "verify", email: "a@b.co", code: bad });
  }
  w.call({ a: "send", email: "a@b.co" }); w.clock.now += 31e3;
  assert.equal(w.call({ a: "verify", email: "a@b.co", code: w.codeOf(w.mails.length - 1) }).error, "locked");
  w.clock.now += 3600e3;   // an hour later it clears
  w.call({ a: "send", email: "a@b.co" });
  assert.equal(w.call({ a: "verify", email: "a@b.co", code: w.codeOf(w.mails.length - 1) }).ok, true);
});

test("codes expire after 10 minutes", () => {
  const w = world();
  w.call({ a: "send", email: "a@b.co" });
  w.clock.now += 10 * 60e3 + 1000;
  assert.equal(w.call({ a: "verify", email: "a@b.co", code: w.codeOf(0) }).error, "expired");
});

test("resend gap (30s) and 5 codes per hour per email", () => {
  const w = world();
  assert.equal(w.call({ a: "send", email: "a@b.co" }).ok, true);
  const r = w.call({ a: "send", email: "a@b.co" });
  assert.equal(r.error, "wait"); assert.ok(r.wait >= 1 && r.wait <= 30);
  for (let i = 0; i < 4; i++) { w.clock.now += 31e3; assert.equal(w.call({ a: "send", email: "a@b.co" }).ok, true); }
  w.clock.now += 31e3;
  assert.equal(w.call({ a: "send", email: "a@b.co" }).error, "limit");
  assert.equal(w.mails.length, 5);
  w.clock.now += 3600e3;
  assert.equal(w.call({ a: "send", email: "a@b.co" }).ok, true);
});

test("the owner's email must use Google (no code is sent, none is accepted)", () => {
  const w = world();
  assert.equal(w.call({ a: "send", email: "housikiki@gmail.com" }).error, "use_google");
  assert.equal(w.call({ a: "verify", email: "HOUSIKIKI@gmail.com", code: "1234" }).error, "use_google");
  assert.equal(w.mails.length, 0);
});

test("daily cap protects the Gmail quota", () => {
  const w = world();
  vm.runInContext("SETTINGS.SENDS_PER_DAY = 2", w.ctx);
  assert.equal(w.call({ a: "send", email: "a@b.co" }).ok, true);
  assert.equal(w.call({ a: "send", email: "c@d.co" }).ok, true);
  assert.equal(w.call({ a: "send", email: "e@f.co" }).error, "busy");
  w.clock.now += 24 * 3600e3;
  assert.equal(w.call({ a: "send", email: "e@f.co" }).ok, true);
});

test("bad input is refused", () => {
  const w = world();
  assert.equal(w.call("not json").error, "bad_request");
  assert.equal(w.call({ a: "send", email: "nope" }).error, "bad_email");
  assert.equal(w.call({ a: "nope", email: "a@b.co" }).error, "bad_request");
  w.call({ a: "send", email: "a@b.co" });
  assert.equal(w.call({ a: "verify", email: "a@b.co", code: "12a4" }).error, "bad_code");
  assert.equal(w.call({ a: "verify", email: "a@b.co", code: "123" }).error, "bad_code");
});

test("missing Firebase key gives a server error, not a token", () => {
  const w = world({ FB_PRIVATE_KEY: "" });
  w.call({ a: "send", email: "a@b.co" });
  assert.equal(w.call({ a: "verify", email: "a@b.co", code: w.codeOf(0) }).error, "server");
});

test("codes look random: always 4 digits, leading zeros kept, whole range used", () => {
  const w = world();
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(vm.runInContext("newCode_()", w.ctx));
  assert.ok([...seen].every(c => /^\d{4}$/.test(c)));
  assert.ok(seen.size > 2000, "distinct codes: " + seen.size);
  assert.ok([...seen].some(c => c.startsWith("0")));
});

test("a send failure leaves no usable code behind", () => {
  const w = world();
  vm.runInContext("MailApp.sendEmail = () => { throw new Error('quota') }", w.ctx);
  assert.equal(w.call({ a: "send", email: "a@b.co" }).error, "send_failed");
  assert.equal(w.call({ a: "verify", email: "a@b.co", code: "1234" }).error, "expired");
});

test("Gmail aliases are the same person: owner can't sneak in, limits and uid are shared", () => {
  const w = world();
  assert.equal(w.call({ a: "send", email: "housikiki+shop@gmail.com" }).error, "use_google");
  assert.equal(w.call({ a: "send", email: "h.ousikiki@googlemail.com" }).error, "use_google");
  const uid = e => { w.call({ a: "send", email: e }); w.clock.now += 31e3;
    const t = w.call({ a: "verify", email: e, code: w.codeOf(w.mails.length - 1) }).token; return JSON.parse(Buffer.from(t.split(".")[1], "base64url")); };
  const a = uid("jo.smith@gmail.com"), b = uid("josmith+beehive@gmail.com");
  assert.equal(a.uid, b.uid);
  assert.equal(b.claims.mail, "josmith+beehive@gmail.com");
  assert.notEqual(uid("someone@example.com").uid, a.uid);
});

const OWNER = { email: "housikiki@gmail.com", emailVerified: true, providerUserInfo: [{ providerId: "google.com" }] };
const NOTIFY = (over = {}) => ({ a: "notify", idToken: "tok-owner", product: "Ajwa Dates <250g>", link: "https://plodroid.github.io/store/#/p/p1", emails: ["a@b.co", "A@B.co", "c@d.co", "bad"], ...over });

test("notify: the verified owner can email waiting customers (deduped, escaped, counted)", () => {
  const w = world({}, { "tok-owner": OWNER });
  const r = w.call(NOTIFY());
  assert.deepEqual(r, { ok: true, sent: 2, sentTo: ["a@b.co", "c@d.co"] });
  assert.equal(w.mails.length, 2);
  assert.match(w.mails[0].subject, /back in stock at Bee Hive$/);
  assert.ok(w.mails[0].htmlBody.includes("Ajwa Dates &lt;250g&gt;") && !w.mails[0].htmlBody.includes("<250g>"));
  assert.ok(w.mails[0].body.includes("https://plodroid.github.io/store/#/p/p1"));
});

test("notify: nobody else can use it", () => {
  const cases = {
    "tok-code": { email: "housikiki@gmail.com", emailVerified: true, providerUserInfo: [{ providerId: "custom" }] },
    "tok-other": { email: "x@y.co", emailVerified: true, providerUserInfo: [{ providerId: "google.com" }] },
    "tok-unverified": { email: "housikiki@gmail.com", emailVerified: false, providerUserInfo: [{ providerId: "google.com" }] },
  };
  const w = world({}, { ...cases, "tok-owner": OWNER });
  for (const t of Object.keys(cases)) assert.equal(w.call(NOTIFY({ idToken: t })).error, "not_owner", t);
  assert.equal(w.call(NOTIFY({ idToken: "forged" })).error, "not_owner");
  assert.equal(w.mails.length, 0);
});

test("notify: refuses other links, empty lists, and respects the daily cap", () => {
  const w = world({}, { "tok-owner": OWNER });
  assert.equal(w.call(NOTIFY({ link: "https://evil.example/x" })).error, "bad_request");
  assert.equal(w.call(NOTIFY({ emails: [] })).error, "bad_request");
  assert.equal(w.call(NOTIFY({ product: "" })).error, "bad_request");
  vm.runInContext("SETTINGS.SENDS_PER_DAY = 1", w.ctx);
  const r = w.call(NOTIFY());
  assert.equal(r.sent, 1); assert.deepEqual(r.sentTo, ["a@b.co"]);
  assert.equal(w.call(NOTIFY()).error, "busy");
});
