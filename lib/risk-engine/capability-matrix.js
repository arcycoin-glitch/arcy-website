'use strict';
// Capability / evidence matrix for the six Risk Engine rules on Arc (5042), Ethereum (1) and Robinhood (4663).
// It is the single documented answer to "why is this rule UNKNOWN here?". It grants nothing: the review gate is
// `rule.producers` in rules.js plus the reviewed-code registry and the producers' own scope. Tests keep them in step.
//
// state:
//   CONFIRM_ONLY  a reviewed producer runs here and can only CONFIRM (never NOT_CONFIRMED)
//   MEASURED      a reviewed producer runs here and may return either verdict for the measured scope (one pool)
//   BLOCKED       no reviewed producer runs here; the engine answers UNKNOWN. `reasonCode` names the missing evidence.
const {RULES}=require('./rules');
const reviewedCode=require('./reviewed-code');
const pool=require('./producers/pool-scope');
const NETWORKS=Object.freeze(['arc','ethereum','robinhood']);
const polarity=p=>!p?'NONE':p.values&&p.values.length===1&&p.values[0]===true||p.verdicts&&p.verdicts.length===1&&p.verdicts[0]===true?'CONFIRM_ONLY':'MEASURED';
const ROWS=Object.freeze({
 'admin-upgrade-authority':{capability:'upgrade',
  requires:['two registered operators at one block hash','privileged-vs-control eth_call differential','reviewed execution route (proxy code + implementation code + actor role + selector) with an exact source match'],
  note:'NOT_CONFIRMED would need a complete audit of every upgrade path; no producer performs one.'},
 'privileged-minting':{capability:'mint',
  requires:['two registered operators at one block hash','privileged-vs-control eth_call differential (owner or MINTER_ROLE member)','reviewed execution route with an exact source match showing that a successful mint increases supply'],
  note:'NOT_CONFIRMED would need a complete audit of every supply-increase path; no producer performs one.'},
 'low-pool-liquidity':{network:n=>pool.supported(n)?null:'PRICE_ANCHOR_NOT_REVIEWED',
  requires:['reviewed V2 factory pool (getPair + pair.factory) read on two operators at one block hash','reviewed Chainlink USD feed for the quote asset (identity, decimals, freshness)','value = 2 x quote reserve x anchor'],
  note:'Only Ethereum has a reviewed USD anchor and reviewed V2 factories. Market-reported liquidity is never used. Arc and Robinhood need a reviewed on-chain USD anchor.'},
 'high-exit-impact':{network:n=>pool.supported(n)?null:'PRICE_ANCHOR_NOT_REVIEWED',
  requires:['the same reviewed pool and USD anchor','a $1,000 sale sized at the pool marginal price','reviewed router getAmountsOut equal to the constant-product model'],
  note:'Positive only: a low model impact says nothing about transfer taxes, blacklists or trading restrictions. V3/V4 pools and Arc/Robinhood are not covered.'},
 'sell-transfer-tax':{blocked:'TRANSFER_DEDUCTION_NOT_ISOLATED',
  requires:['balance deltas across a simulated sell transfer (state override or trace) on two operators','separation of the token-side deduction from pool fee and price impact','account-dependent exemptions'],
  note:'A router quote mixes pool fee, impact and token deductions; a tax is never inferred from it. No reviewed state-override simulation exists yet.'},
 'top-ten-holder-concentration':{
  requires:['candidate addresses from the public explorer holder list (addresses only, untrusted)','balances, totalSupply, burn balances and code checks read on two operators at one block hash','>= 50% held by ten non-contract addresses of the non-burned supply'],
  note:'Positive only: the converse needs a complete reconciled census on two operators, which does not exist.'}
});
function rowFor(rule){
 const spec=ROWS[rule.id],p=rule.producers[0]||null;
 const networks=Object.fromEntries(NETWORKS.map(n=>{
  if(!p)return [n,Object.freeze({state:'BLOCKED',reviewedRoutes:0,reasonCode:spec.blocked})];
  if(spec.capability){
   const routes=reviewedCode.REGISTRY.entries.filter(e=>e.network===n&&e.capability===spec.capability).length;
   return [n,Object.freeze({state:polarity(p),reviewedRoutes:routes,reasonCode:routes?null:'NO_REVIEWED_EXECUTION_ROUTE'})];
  }
  const blocked=spec.network?spec.network(n):null;
  return [n,Object.freeze(blocked?{state:'BLOCKED',reviewedRoutes:0,reasonCode:blocked}:{state:polarity(p),reviewedRoutes:0,reasonCode:null})];
 }));
 return Object.freeze({metricId:rule.metricId,ruleVersion:rule.version,producer:p?.id||null,minVersion:p?.minVersion||null,polarity:polarity(p),
  networks:Object.freeze(networks),requires:Object.freeze([...spec.requires]),note:spec.note});
}
const MATRIX=Object.freeze(Object.fromEntries(RULES.map(rule=>[rule.id,rowFor(rule)])));
// {ruleId: reasonCode|null} for one network: the truthful explanation attached to UNKNOWN findings in shadow output.
const blockers=network=>NETWORKS.includes(network)?Object.fromEntries(Object.entries(MATRIX).map(([id,row])=>[id,row.networks[network].reasonCode])):null;
module.exports={MATRIX,NETWORKS,blockers};
