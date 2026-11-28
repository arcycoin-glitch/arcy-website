'use strict';
// User-facing derived observations that can be independently reconstructed
// from already returned exact-contract evidence. No new network requests.
const CHAIN_IDS=Object.freeze({arc:5042,ethereum:1,robinhood:4663});
const DECIMAL=/^(?:0|[1-9]\d*)(?:\.(\d{1,36}))?$/;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const missing=(reason,code='DERIVED_EVIDENCE_INCOMPLETE')=>({
 value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',reason,reasonCode:code,
 source:null,evidence:[]
});
function decimal(value){
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const s=String(value);
 if(s.length>125||!DECIMAL.test(s))return null;
 const [whole,fraction='']=s.split('.');
 return {whole,fraction};
}
function scaledAmounts(a,b){
 const x=decimal(a),y=decimal(b);
 if(!x||!y)return null;
 const places=Math.max(x.fraction.length,y.fraction.length);
 const scale=10n**BigInt(places);
 return {total:BigInt(x.whole)*scale+BigInt(x.fraction.padEnd(places,'0')||'0'),
  burn:BigInt(y.whole)*scale+BigInt(y.fraction.padEnd(places,'0')||'0'),places};
}
function stringify(raw,places){
 const sign=raw<0n?'-':'';
 const digits=(raw<0n?-raw:raw).toString().padStart(places+1,'0');
 if(!places)return sign+digits;
 const frac=digits.slice(-places).replace(/0+$/,'');
 return sign+digits.slice(0,-places)+(frac?'.'+frac:'');
}
function valid(field,context,{onchain=false}={}){
 const proof=field?.evidence?.[0],address=String(context?.address||'').toLowerCase();
 if(!CHAIN_IDS[context?.network]||context.chainId!==CHAIN_IDS[context.network]||
    !ADDRESS.test(address)||!field||field.dataState!=='DATA_FOUND'||
    field.network!==context.network||field.chainId!==context.chainId||
    typeof field.source!=='string'||!field.source.trim()||!proof||typeof proof!=='object')return false;
 if(typeof proof.address!=='string'||proof.address.toLowerCase()!==address)return false;
 if(proof.network!==undefined&&proof.network!==context.network)return false;
 if(proof.chainId!==undefined&&proof.chainId!==context.chainId)return false;
 if(onchain){
  if(!/^ON_CHAIN$|^ONCHAIN_VERIFIED$/.test(field.status||'')||
    typeof context.block!=='string'||!/^0x[0-9a-f]+$/i.test(context.block)||
    proof.block!==context.block)return false;
 }
 return true;
}
function supply(fields,context){
 const total=fields?.totalSupply,burn=fields?.burnAddressBalance;
 const notAvailable={
  nonBurnSupply:missing('Both totalSupply() and zero/dead address balances must be available from the same pinned chain block.','PINNED_SUPPLY_OR_BURN_UNAVAILABLE'),
  burnAddressPct:missing('Cannot calculate current zero/dead-address share without both pinned balances.','PINNED_SUPPLY_OR_BURN_UNAVAILABLE')
 };
 if(!valid(total,context,{onchain:true})||!valid(burn,context,{onchain:true})||
    total.source!==burn.source)return notAvailable;
 const n=scaledAmounts(total.value,burn.value);
 if(!n||n.total<=0n||n.burn<0n||n.burn>n.total)return {
  nonBurnSupply:missing('On-chain quantities or their units cannot be reconciled.','SUPPLY_BURN_UNITS_INCONSISTENT'),
  burnAddressPct:missing('On-chain quantities or their units cannot be reconciled.','SUPPLY_BURN_UNITS_INCONSISTENT')
 };
 const proof={network:context.network,chainId:context.chainId,address:context.address,
  block:context.block,checkedAt:new Date().toISOString(),sources:[
   {method:total.evidence[0]?.method??'totalSupply()',source:total.source},
   {method:burn.evidence[0]?.method??'balanceOf(zero/dead)',source:burn.source}
  ],scope:'Pinned current holdings at zero and 0xdead addresses. Outside-burn supply is not verified circulating/free-float supply; addresses can include irretrievable or recoverable custody. Not proof of historical destruction.'};
 const outside=stringify(n.total-n.burn,n.places);
 const p=Number((n.burn*100n*10n**12n+n.total/2n)/n.total)/1e12;
 return {
  nonBurnSupply:{value:outside,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',
   source:total.source,network:context.network,chainId:context.chainId,
   evidence:[{...proof,method:'totalSupply() - balanceOf(zero/dead)'}]},
  burnAddressPct:{value:p,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',
   source:total.source,network:context.network,chainId:context.chainId,
   evidence:[{...proof,method:'balanceOf(zero/dead) / totalSupply() × 100'}]}
 };
}
function comparable(a,b,context){
 if(!valid(a,context)||!valid(b,context)||a.source!==b.source)return false;
 const x=a.evidence[0],y=b.evidence[0];
 // Both values must be based on one provider snapshot and same pool set.
 const u=x.url??x.sourceUrl,v=y.url??y.sourceUrl;
 if(typeof u==='string'||typeof v==='string'){
  if(typeof u!=='string'||u!==v||!/^https:\/\//.test(u))return false;
 }else{
  // The existing Arc legacy DexScreener market adapter returns one
  // exact-contract pool dataset with no URL in compact evidence. The two
  // metrics must share the same marked pool-dataset scope AND retrieval time.
  if(a.source!=='DexScreener'||x.scope!=='Exact-contract source-returned pool dataset, not an exhaustive chain-wide inventory.'||
   x.scope!==y.scope||typeof x.checkedAt!=='string'||x.checkedAt!==y.checkedAt)return false;
 }
 if(x.fetchedAt!==undefined||y.fetchedAt!==undefined){
  if(!x.fetchedAt||x.fetchedAt!==y.fetchedAt)return false;
 }
 const pairs=x.pairs,yPairs=y.pairs;
 if(Array.isArray(pairs)||Array.isArray(yPairs)){
  if(!Array.isArray(pairs)||!Array.isArray(yPairs)||
     pairs.length!==yPairs.length||pairs.some((p,i)=>p!==yPairs[i]))return false;
 }
 return true;
}
// Compatible-scope turnover (same provider response, differing pool lists). DEX Screener sums liquidity only over pools that report a
// liquidity.usd and volume over every returned pool, so the two pair lists can differ by volume-only pools. When both fields come from
// the SAME provider response (same URL and retrieval time) and carry first-party per-pool values, turnover is computed over exactly the
// pools that hold the liquidity: sum(volume of those pools) / sum(liquidity of those pools). Pools without liquidity are excluded and
// reported; nothing is estimated and no pool is attributed a value the provider did not return.
function poolIntersectionTurnover(a,b,context){
 if(!valid(a,context)||!valid(b,context)||a.source!=='DEX Screener'||b.source!=='DEX Screener')return null;
 const x=a.evidence[0],y=b.evidence[0],u=x.url??x.sourceUrl,v=y.url??y.sourceUrl;
 if(typeof u!=='string'||u!==v||!/^https:\/\/dexscreener\.com\//.test(u)||!x.checkedAt||x.checkedAt!==y.checkedAt)return null;
 const lp=x.pairs,lv=x.pairLiquidityUsd,vp=y.pairs,vv=y.pairVolumeUsd;
 if(![lp,lv,vp,vv].every(Array.isArray)||lp.length!==lv.length||vp.length!==vv.length||!lp.length)return null;
 if(lp.some(p=>typeof p!=='string')||new Set(lp).size!==lp.length||new Set(vp).size!==vp.length)return null;
 const vol=new Map(vp.map((p,i)=>[p,vv[i]]));
 let liq=0,num=0;
 for(let i=0;i<lp.length;i++){
  const l=lv[i],q=vol.get(lp[i]);
  if(!Number.isFinite(l)||l<0||!Number.isFinite(q)||q<0)return null; // every liquidity pool needs a first-party volume value
  liq+=l;num+=q;
 }
 // The per-pool values must reproduce the reported total (rounding only), or the evidence is not what the field claims.
 if(!(liq>0)||Math.abs(liq-Number(a.value))>Math.max(1e-6,Math.abs(Number(a.value))*1e-9))return null;
 const lset=new Set(lp),extra=vp.filter(p=>!lset.has(p));
 const extraUsd=extra.reduce((t,p)=>t+(vol.get(p)||0),0);
 const pct=num/liq*100;
 if(!Number.isFinite(pct)||pct>1e12)return null;
 return {value:Math.round(pct*1e8)/1e8,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',
  source:a.source+' (derived)',network:context.network,chainId:context.chainId,
  evidence:[{network:context.network,chainId:context.chainId,address:context.address,sourceUrl:u,checkedAt:x.checkedAt,
   method:'24h volume USD of the liquidity-reporting pools / their pool liquidity USD x 100',
   numerator24hUsd:num,denominatorLiquidityUsd:liq,pools:lp.length,volumeOnlyPoolsExcluded:extra.length,volumeOnlyUsdExcluded:extraUsd,
   scope:'Same provider response, restricted to the pools that report liquidity; volume of pools without a liquidity value is excluded. Not chain-wide DEX turnover. Not a liquidity lock, sell execution guarantee, or investment safety rating.'}]};
}
// Same-pool on-chain turnover: both the liquidity and the volume cross-check were reproduced from the chain for the SAME pool set
// (identical pool addresses/ids), each AGREEing with the provider. Value = on-chain swap volume / on-chain pool TVL of those pools.
function onchainTurnover(a,b,context){
 if(a?.crossCheck?.state!=='AGREE'||b?.crossCheck?.state!=='AGREE')return null;
 // Liquidity cross-check method: arcy-market-onchain-1 (pool reserves); volume cross-check method: arcy-market-volume-1 (24h swap logs).
 const cx=(f,m)=>(f.evidence||[]).find(e=>e?.role==='cross-check'&&e.method===m&&Array.isArray(e.pools)&&e.pools.length);
 const l=cx(a,'arcy-market-onchain-1'),v=cx(b,'arcy-market-volume-1');
 if(!l||!v||l.source!==v.source)return null;
 const ids=e=>e.pools.map(p=>String(p.pool).toLowerCase()).sort();
 const li=ids(l),vi=ids(v);
 if(JSON.stringify(li)!==JSON.stringify(vi)||new Set(li).size!==li.length)return null;
 const tvl=l.pools.reduce((t,p)=>t+(Number.isFinite(p.usd)?p.usd:NaN),0),vol=v.pools.reduce((t,p)=>t+(Number.isFinite(p.usd)?p.usd:NaN),0);
 if(!(tvl>0)||!Number.isFinite(vol)||vol<0)return null;
 const pct=vol/tvl*100;if(!Number.isFinite(pct)||pct>1e12)return null;
 return {value:Math.round(pct*1e8)/1e8,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',
  source:l.source+' (derived)',network:context.network,chainId:context.chainId,
  evidence:[{network:context.network,chainId:context.chainId,address:context.address,checkedAt:new Date().toISOString(),
   method:'on-chain 24h swap volume USD / on-chain pool liquidity USD x 100, identical pool set',
   numerator24hUsd:vol,denominatorLiquidityUsd:tvl,pools:li.length,poolIds:li,
   scope:'Only the pools reproduced from the chain for both inputs (a lower bound of the provider scope). Not chain-wide DEX turnover. Not a liquidity lock, sell execution guarantee, or investment safety rating.'}]};
}
function liquidity(fields,context){
 const a=fields?.liquidityUsd,b=fields?.volume24h;
 if(!comparable(a,b,context)){
  const alt=poolIntersectionTurnover(a,b,context)||onchainTurnover(a,b,context);
  if(alt)return alt;
  return missing(
   'Comparable same-provider, exact-contract 24h volume and USD pool reserves were not available.','LIQUIDITY_VOLUME_NOT_COMPARABLE');
 }
 const liq=Number(a.value),volume=Number(b.value);
 if(!Number.isFinite(liq)||!Number.isFinite(volume)||liq<=0||volume<0)return missing(
  'Pool USD liquidity must be positive and 24h trading volume must be nonnegative.','LIQUIDITY_VOLUME_UNAVAILABLE');
 // A 24h turnover ratio may exceed 100%; it is not a security score.
 const pct=volume/liq*100;
 if(!Number.isFinite(pct)||pct>1e12)return missing('Reported values are outside safe ratio range.','TURNOVER_OUT_OF_RANGE');
 return {value:Math.round(pct*1e8)/1e8,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',
  source:a.source+' (derived)',network:context.network,chainId:context.chainId,
  evidence:[{network:context.network,chainId:context.chainId,address:context.address,
   sourceUrl:a.evidence[0].sourceUrl??a.evidence[0].url,
   checkedAt:new Date().toISOString(),
   method:'tracked 24h volume USD / tracked pool liquidity USD × 100',
   numerator24hUsd:volume,denominatorLiquidityUsd:liq,
   scope:'Same provider-reported pool subset, not chain-wide DEX turnover. Not a liquidity lock, sell execution guarantee, or investment safety rating.'}]};
}
module.exports={supply,liquidity,scaledAmounts,stringify,valid,comparable};
