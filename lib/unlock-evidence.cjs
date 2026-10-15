// CommonJS mirror for the persistent Railway worker. Keep this list aligned with
// unlock-evidence.js, which remains ESM for the existing Vercel/test harness.
const VERIFIED_EVENTS = [];
const COVERAGE_REVIEWS = [
  { projectId: 'arbitrum', name: 'Arbitrum', symbols: ['ARB'], date: '2026-10-15', status: 'cross-source-date-allocation-conflict', reason: 'CoinBell lists 92.65M ARB on 15 October 2026 (Team), while Tokenomist lists the next unlock on 16 October 2026 and Arbitrum DAO documents monthly team/investor releases from the 16th. Neither the date nor allocation can be independently verified as this exact row; suppress the disputed calendar event until primary evidence is reviewed.', sources: ['https://api.coinbell.in/token-unlocks?sort=soonest&window=30', 'https://tokenomist.ai/arbitrum', 'https://docs.arbitrum.foundation/token-supply'] },
  { projectId: 'io-net', name: 'io.net', symbols: ['IO'], status: 'insufficient-evidence', reason: 'Monthly vesting is documented, but no explicit current event date and amount have been verified.', sources: ['https://io.net/docs/guides/coin/coin-restrictions'] },
  { projectId: 'plume', name: 'Plume', symbols: ['PLUME'], status: 'estimated-schedule', reason: 'Published release chart is estimated; do not convert it into exact monthly unlocks.', sources: ['https://www.plume.org/blog/tokenomics', 'https://defillama.com/unlocks/plume-mainnet'] },
  { projectId: 'mantra', name: 'MANTRA', symbols: ['OM', 'MANTRA'], status: 'migration-review-required', reason: 'Legacy OM and native MANTRA use different units following a 1:4 conversion; current event evidence is required.', sources: ['https://docs.mantrachain.io/mantra-chain-tokenomics'] }
];
module.exports = { VERIFIED_EVENTS, COVERAGE_REVIEWS };
