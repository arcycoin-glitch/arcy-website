'use strict';
// Capability / evidence matrix for the six Risk Engine V1 rules on Arc (5042), Ethereum (1) and Robinhood (4663).
// It is the single documented answer to "why is this rule UNKNOWN here?". It grants nothing: the review gate is
// `rule.producers` in rules.js plus the reviewed-code registry. A test keeps this matrix and that gate in step.
//
// state:
//   POSITIVE_ONLY  a reviewed producer exists and can only CONFIRM (never NOT_CONFIRMED)
//   BLOCKED        no reviewed producer; the engine answers UNKNOWN. `reasonCode` names the missing evidence.
const {RULES}=require('./rules');
const reviewedCode=require('./reviewed-code');
const NETWORKS=Object.freeze(['arc','ethereum','robinhood']);
const all=value=>Object.freeze(Object.fromEntries(NETWORKS.map(n=>[n,value])));
const BLOCKERS=Object.freeze({
 'high-exit-impact':{reasonCode:all('PRICE_ANCHOR_NOT_REVIEWED'),
  requires:['reviewed same-block USD price anchor for the quote asset, read from two operators','pool state replay at the same block hash from two operators','fixed $1,000 probe sized with that anchor'],
  note:'Arc and Robinhood have no reviewed on-chain USD feed. Ethereum needs a reviewed Chainlink feed per quote asset (address, decimals, heartbeat, staleness bound) before any producer.'},
 'low-pool-liquidity':{reasonCode:all('RESERVE_VALUATION_NOT_REVIEWED'),
  requires:['pool reserves from two operators at one block hash','reviewed USD valuation of BOTH reserve assets at that block','pool identity proven by a reviewed factory'],
  note:'Market-reported liquidity (DexScreener / GeckoTerminal) is a single off-chain source and is never used as proof.'},
 'sell-transfer-tax':{reasonCode:all('TRANSFER_DEDUCTION_NOT_ISOLATED'),
  requires:['balance deltas across a simulated transfer into the pool (state override or trace) on two operators','separation of the token-side deduction from pool fee and price impact'],
  note:'A router quote mixes pool fee, impact and token deductions; a tax is never inferred from it. The public endpoints in use offer no reviewed state-override / trace path.'},
 'top-ten-holder-concentration':{reasonCode:Object.freeze({arc:'HOLDER_CENSUS_SINGLE_OPERATOR',ethereum:'HOLDER_CENSUS_UNAVAILABLE',robinhood:'HOLDER_CENSUS_UNAVAILABLE'}),
  requires:['complete holder set reconciled to total supply at one block hash','the reconciliation reproduced by a second operator','an explicit eligibility policy (burn, pool, bridge, treasury, staking addresses) reviewed per token'],
  note:'Arc has a worker census reconciled to supply, but from one operator and without an eligibility policy. Ethereum and Robinhood have no complete census.'}
});
function authority(capability){
 return Object.freeze(Object.fromEntries(NETWORKS.map(n=>{
  const routes=reviewedCode.REGISTRY.entries.filter(e=>e.network===n&&e.capability===capability).length;
  return [n,Object.freeze({state:'POSITIVE_ONLY',reviewedRoutes:routes,reasonCode:routes?null:'NO_REVIEWED_EXECUTION_ROUTE'})];
 })));
}
const MATRIX=Object.freeze(Object.fromEntries(RULES.map(rule=>{
 const capability={'admin-upgrade-authority':'upgrade','privileged-minting':'mint'}[rule.id];
 if(capability)return [rule.id,Object.freeze({metricId:rule.metricId,producer:rule.producers[0]?.id||null,minVersion:rule.producers[0]?.minVersion||null,polarity:'CONFIRM_ONLY',networks:authority(capability),
  requires:Object.freeze(['two registered operators at one block hash','privileged-vs-control eth_call differential','reviewed execution route (proxy code + implementation code + actor role + selector) with an exact source match']),
  note:'NOT_CONFIRMED would need a complete audit of every upgrade / supply-increase path; no producer performs one.'})];
 const b=BLOCKERS[rule.id];
 return [rule.id,Object.freeze({metricId:rule.metricId,producer:null,minVersion:null,polarity:'NONE',
  networks:Object.freeze(Object.fromEntries(NETWORKS.map(n=>[n,Object.freeze({state:'BLOCKED',reviewedRoutes:0,reasonCode:b.reasonCode[n]})]))),requires:Object.freeze([...b.requires]),note:b.note})];
})));
// {ruleId: reasonCode|null} for one network: the truthful explanation attached to UNKNOWN findings in shadow output.
const blockers=network=>NETWORKS.includes(network)?Object.fromEntries(Object.entries(MATRIX).map(([id,row])=>[id,row.networks[network].reasonCode])):null;
module.exports={MATRIX,NETWORKS,blockers};
require('./producers/pool');
