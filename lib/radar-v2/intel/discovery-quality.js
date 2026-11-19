'use strict';
// ARCY Radar — evidence-first DISPLAY gate. Never claims a coin is "safe" or will rise.
// Prevents an artificial 10-row target from promoting already-spiking, untradeably thin,
// unbranded or uncorroborated early-stage candidates. Only Arc/Ethereum; Pons/Robinhood
// have their own microcap/factory market conditions.
// Snapshot building never guesses missing market facts. A missing observation fails
// the monitor gate instead of becoming a fabricated zero or a fabricated good result.
const {PROFILES}=require('../discovery');
const MARKETS=Object.freeze({
 arc:Object.freeze({minLiquidity:PROFILES.arc.minLiq*0.5,minVolume:PROFILES.arc.minVol*0.25}),
 ethereum:Object.freeze({minLiquidity:PROFILES.ethereum.minLiq*0.5,minVolume:PROFILES.ethereum.minVol*0.25})
});
const MAX_24H_RISE=70; // presentation / late-chase control, not a price forecast
const MAX_24H_DROP=-50; // unstable short-term price; no assertion of manipulation
const MAX_TURNOVER=5;
const MIN_TRADES=10,DAY_MS=86400000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const identityCorroborated=row=>row?.v3Verification?.crossCheck==='MATCHED'||row?.sourceEvidence?.crossCheck==='MATCHED'||
 row?.universe?.identity?.status==='TWO_SOURCE_SYMBOL_MATCH'||row?.registered===true;
// V5 (#279): the extreme 24h run-up / crash rule also applies to Robinhood Chain and Pons Launch. Their microcap liquidity,
// volume and artwork rules stay as before (factory/market conditions differ); only "do not chase extreme moves" is shared.
const MOVE_ONLY=new Set(['robinhood','pons']);
function reason(row,network){
 if(MOVE_ONLY.has(network)){
  if(finite(row.change24hPct)&&row.change24hPct>=MAX_24H_RISE)return 'ALREADY_SPIKED_24H';
  if(finite(row.change24hPct)&&row.change24hPct<=MAX_24H_DROP)return 'EXTREME_DRAWDOWN_24H';
  // A monitor-only row (weakest evidence class) needs corroborated exact-contract identity (#279 V5: artwork is NOT evidence).
  if(row.discoveryClass==='MONITOR_ONLY'&&!identityCorroborated(row))return 'EXACT_CONTRACT_IDENTITY_NOT_CORROBORATED';
  return null;
 }
 const p=MARKETS[network];if(!p)return null;
 // If observed a massive recent pump / crash, exclude from *early discovery*,
 // even if V3's numerical discovery gates had passed. Unknown momentum is never
 // asserted to be "pre-pump" or stable.
 if(finite(row.change24hPct)&&row.change24hPct>=MAX_24H_RISE)return 'ALREADY_SPIKED_24H';
 if(finite(row.change24hPct)&&row.change24hPct<=MAX_24H_DROP)return 'EXTREME_DRAWDOWN_24H';
 // Leave V3's genuinely ranked candidates otherwise unchanged; only the
 // near-match/monitor expansion must clear these additional quality requirements.
 if(row.discoveryClass==='QUALIFIED')return null;
 if(!finite(row.priceUsd)||row.priceUsd<=0)return 'PRICE_NOT_OBSERVED';
 if(!finite(row.liquidityUsd)||row.liquidityUsd<p.minLiquidity)return 'LIQUIDITY_DEPTH_INSUFFICIENT';
 if(!finite(row.volume24hUsd)||row.volume24hUsd<p.minVolume)return 'ORGANIC_ACTIVITY_NOT_ESTABLISHED';
 if(row.volume24hUsd>row.liquidityUsd*MAX_TURNOVER)return 'HIGH_VOLUME_TO_LIQUIDITY_RATIO';
 if(!finite(row.trades24h)||row.trades24h<MIN_TRADES)return 'TRADES_INSUFFICIENT';
 if(!finite(row.change24hPct))return 'MOMENTUM_NOT_OBSERVED';
 // V5 (#279): a logo is decorative and never evidence. A near-match / monitor row instead needs its exact contract
 // corroborated by an independent source (V3 or builder cross-check matched); a missing logo uses the existing placeholder.
 if(!identityCorroborated(row))return 'EXACT_CONTRACT_IDENTITY_NOT_CORROBORATED';
 if(row.discoveryClass==='MONITOR_ONLY'){
  const created=Date.parse(row.poolCreatedAt||'');
  if(!Number.isFinite(created)||!finite(row.snapshotNow)||created>row.snapshotNow-DAY_MS)
   return 'MATURE_POOL_NOT_EVIDENCED';
 }
 return null;
}
module.exports={identityCorroborated,reason,MOVE_ONLY,MARKETS,MAX_24H_RISE,MAX_24H_DROP,MAX_TURNOVER,MIN_TRADES};
