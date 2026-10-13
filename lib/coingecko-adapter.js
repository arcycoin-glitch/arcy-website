// CoinGecko free-tier usage is not approved for this public commercial product.
// Keep the legacy route shape, but fail closed before making any upstream call.
const c = require('../lib/core');

module.exports = c.route(async () => ({
  status: 'NOT_VERIFIED',
  circulatingSupply: null,
  source: 'CoinGecko',
  contractMatched: false,
  dataState: 'SOURCE_HAS_NO_DATA',
  reasonCode: 'PROVIDER_DISABLED_LICENSE_UNVERIFIED',
  reason: 'CoinGecko data is disabled until public commercial-use permission is verified.'
}));
