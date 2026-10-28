/**
 * NOT ACTIVE — placeholder showing where Stripe goes.
 *
 * Plan (see README "Adding real payments"):
 *  1. `npm i stripe` in /functions and store the secret key with
 *       firebase functions:secrets:set STRIPE_SECRET_KEY
 *  2. authorize() creates a PaymentIntent for totalPence (currency "gbp") and returns
 *       { paymentStatus: "pending", isTest: false, providerRef: paymentIntent.id,
 *         clientSecret: paymentIntent.client_secret }
 *  3. The website confirms the card with Stripe.js (card details never touch our servers).
 *  4. A new HTTPS function receives Stripe's webhook, verifies the signature and sets
 *       orders/{id}.paymentStatus = "paid" | "failed" | "refunded".
 *  5. Register this provider in ./index.js as `stripe`.
 *
 * Until then this file is intentionally not imported anywhere.
 */
module.exports = {
  name: "stripe",
  isLive: true,
  async authorize() {
    throw new Error("Stripe is not configured yet.");
  },
};
