// CommonJS mirror for the persistent Railway worker. Keep this list aligned with
// unlock-evidence.js, which remains ESM for the existing Vercel/test harness.
const VERIFIED_EVENTS = [];
const COVERAGE_REVIEWS = [
  { projectId: 'io-net', name: 'io.net', symbols: ['IO'], status: 'insufficient-evidence', reason: 'Monthly vesting is documented, but no explicit current event date and amount have been verified.', sources: ['https://io.net/docs/guides/coin/coin-restrictions'] },
  { projectId: 'plume', name: 'Plume', symbols: ['PLUME'], status: 'estimated-schedule', reason: 'Published release chart is estimated; do not convert it into exact monthly unlocks.', sources: ['https://www.plume.org/blog/tokenomics', 'https://defillama.com/unlocks/plume-mainnet'] },
  { projectId: 'mantra', name: 'MANTRA', symbols: ['OM', 'MANTRA'], status: 'migration-review-required', reason: 'Legacy OM and native MANTRA use different units following a 1:4 conversion; current event evidence is required.', sources: ['https://docs.mantrachain.io/mantra-chain-tokenomics'] }
];
module.exports = { VERIFIED_EVENTS, COVERAGE_REVIEWS };
