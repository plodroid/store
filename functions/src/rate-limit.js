const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { Timestamp } = require("firebase-admin/firestore");
const { rateWindow } = require("./shop-logic");

/** A hashed per-visitor key. Raw IP addresses are never stored. */
function clientKey(request, kind) {
  const raw = request.rawRequest;
  const fwd = raw && raw.headers ? String(raw.headers["x-forwarded-for"] || "") : "";
  const ip = fwd.split(",")[0].trim() || (raw && raw.ip) || "unknown";
  return crypto.createHash("sha256").update(`${kind}:${ip}`).digest("hex").slice(0, 40);
}

/** Throws resource-exhausted when a visitor goes over `limit` calls per window. */
async function checkRate(db, key, limit, windowMs) {
  const ref = db.collection("rateLimits").doc(key);
  const allowed = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const r = rateWindow(snap.exists ? snap.data() : null, Date.now(), limit, windowMs);
    // expiresAt lets an optional Firestore TTL policy clean these up automatically
    tx.set(ref, { ...r.next, expiresAt: Timestamp.fromMillis(r.next.windowStart + windowMs) });
    return r.allowed;
  });
  if (!allowed) throw new HttpsError("resource-exhausted", "Too many attempts. Please wait a few minutes and try again.");
}

module.exports = { clientKey, checkRate };
