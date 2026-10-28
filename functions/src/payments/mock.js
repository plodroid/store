/**
 * Mock payment provider — NO money is taken, NO card details are collected.
 * Orders paid this way are marked isTest: true and paymentStatus: "mock",
 * and the owner app keeps them out of every sales figure.
 */
module.exports = {
  name: "mock",
  isLive: false,
  async authorize({ orderId }) {
    return { paymentStatus: "mock", isTest: true, providerRef: `mock_${orderId}` };
  },
};
