/**
 * Payment provider registry.
 *
 * Every provider exposes the same shape:
 *   name:      string
 *   isLive:    boolean  — true only when real money moves
 *   authorize({ orderId, ref, totalPence, currency }) → { paymentStatus, isTest, providerRef }
 *
 * Today only "mock" exists. To add Stripe later, implement ./stripe.js with the
 * same shape and register it below — placeOrder doesn't need to change.
 */
const mock = require("./mock");

const providers = { mock };

function getProvider(method) {
  const p = providers[method];
  if (!p) {
    const err = new Error(`Payment method "${method}" is not available.`);
    err.code = "payment-unavailable";
    throw err;
  }
  return p;
}

module.exports = { getProvider };
