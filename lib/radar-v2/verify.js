'use strict';
// Field-level verification. Two independent public indexers (GeckoTerminal, DEX Screener) agreeing on the SAME pool is
// CROSS_VERIFIED. One provider alone is SOURCE_REPORTED. Missing or contradicting values are NOT_VERIFIED. Nothing is estimated.
// This is agreement between indexers, not an onchain proof.
const TOLERANCE=Object.freeze({priceUsd:0.03,volume24hUsd:0.25,liquidityUsd:0.25,fdvUsd:0.10,marketCapUsd:0.10,change24hPct:{abs:3},poolCreatedAt:{ms:10*60*1000}});
const FIELDS=['priceUsd','volume24hUsd','liquidityUsd','change24hPct','fdvUsd','marketCapUsd','poolCreatedAt'];
const LIQ_DEF_RATIO=Object.freeze([1.85,2.15]);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function agree(name,a,b){
 const t=TOLERANCE[name];
 if(name==='poolCreatedAt'){const x=Date.parse(a),y=Date.parse(b);return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=t.ms;}
 if(!finite(a)||!finite(b))return false;
 if(t.abs!==undefined)return Math.abs(a-b)<=t.abs;
 if(a===0&&b===0)return true;
 return Math.abs(a-b)<=t*Math.max(Math.abs(a),Math.abs(b));
}
const has=v=>v!==null&&v!==undefined&&!(typeof v==='number'&&!Number.isFinite(v));
// Token-level cross-check input. GeckoTerminal states token-level price/volume/liquidity/cap (tokens/multi); DEX Screener is
// aggregated over EVERY pair it lists for the exact contract. Price, cap and FDV come from DEX Screener's most liquid pair where the
// token is the base. Volume and liquidity are summed over all its pairs but only trusted when the list is provably complete
// (DEX Screener caps a token's pair list; at the cap the sum is a lower bound and is not used). Change and pool age are
// pool-specific and compared only against the SAME pool.
const PAIR_CAP=30;
function summarize(gt,pairs){
 if(!pairs||!pairs.length)return {state:'NO_MATCH'};
 const base=pairs.filter(p=>p.side==='base'&&p.token===gt.address);
 const best=base.reduce((a,p)=>(!a||(p.liquidityUsd||0)>(a.liquidityUsd||0))?p:a,null);
 const matched=base.find(p=>p.pair===gt.pool)||null;
 const complete=pairs.length<PAIR_CAP;
 const sum=k=>complete&&pairs.every(p=>has(p[k]))?pairs.reduce((a,p)=>a+p[k],0):null;
 return {state:'MATCHED',pair:best||pairs[0],matched,pairCount:pairs.length,complete,
  values:{
   priceUsd:best?.priceUsd??null,marketCapUsd:best?.marketCapUsd??null,fdvUsd:best?.fdvUsd??null,
   volume24hUsd:gt.scopeVolume==='POOL'?(matched?.volume24hUsd??null):sum('volume24hUsd'),
   liquidityUsd:gt.scopeLiquidity==='POOL'?(matched?.liquidityUsd??null):sum('liquidityUsd'),
   change24hPct:matched?.change24hPct??null,poolCreatedAt:matched?.pairCreatedAt??null},
  logo:best?.logo||base.find(p=>p.logo)?.logo||null,url:(matched||best||pairs[0])?.url||null};
}
// state: 'DISABLED' | 'UNAVAILABLE' | 'NO_MATCH' | 'MATCHED'
function verifyRow(gt,ds,opts={}){
 const state=ds?.state||'DISABLED',m=state==='MATCHED'?ds:null,fields={};
 for(const f of FIELDS){
  const g=gt[f],d=m?m.values[f]:null,src=[];
  if(has(g))src.push({provider:'GeckoTerminal',value:g});
  if(has(d))src.push({provider:'DEX Screener',value:d});
  const scope=f==='volume24hUsd'?(gt.scopeVolume==='POOL'?'POOL':'TOKEN'):f==='liquidityUsd'?(gt.scopeLiquidity==='POOL'?'POOL':'TOKEN'):undefined;
  const meta=scope?{scope}:{};
  if(!has(g)&&!has(d)){fields[f]={status:'NOT_VERIFIED',value:null,...explain(f,gt,m,opts),sources:[],...meta};continue;}
  if(has(g)&&has(d)){
   if(agree(f,g,d)){fields[f]={status:'CROSS_VERIFIED',value:g,sources:src,...meta};continue;}
   // Token-level volume/liquidity: GeckoTerminal indexes every pool it knows, DEX Screener sums only its own pairs. A DEX Screener
   // total clearly BELOW the GeckoTerminal figure is partial coverage, not a contradiction: the value stays single-source (never
   // cross-checked) and the lower figure is kept as evidence. A DEX Screener total ABOVE it cannot be explained that way and stays NOT_VERIFIED.
   if(scope==='TOKEN'&&(f==='volume24hUsd'||f==='liquidityUsd')&&d<g){fields[f]={status:'SOURCE_REPORTED',value:g,sources:src,...meta,crossCheck:'PARTIAL_COVERAGE'};continue;}
   // Liquidity definition difference (evidence: CI probe 'liquidity-definition', 6 graduated Pons/Uniswap v4 pools, raw provider fields):
   //  - pool level: GeckoTerminal pool reserve_in_usd == DEX Screener liquidity.usd (ratio 0.99-1.03); DEX Screener's figure equals base-side value + quote-side value.
   //  - token level: GeckoTerminal total_reserve_in_usd is ~0.5x of that (it counts only the token's own side; 0.96-1.0x of the base-side value).
   // So a TOKEN-scoped GeckoTerminal liquidity compared with DEX Screener at 1.85-2.15x is a definition difference, not a contradiction. The LOWER
   // (conservative) figure is kept as single-source evidence and is NEVER promoted to CROSS_VERIFIED. POOL-scoped values are like-for-like, so a 2x gap there stays NOT_VERIFIED.
   if(f==='liquidityUsd'&&scope==='TOKEN'&&g>0&&d/g>=LIQ_DEF_RATIO[0]&&d/g<=LIQ_DEF_RATIO[1]){fields[f]={status:'SOURCE_REPORTED',value:g,sources:src,...meta,crossCheck:'PROVIDER_DEFINITION_2X',definitionNote:'GeckoTerminal token total counts one side of the pool; DEX Screener counts both sides. Lower figure kept.'};continue;}
   fields[f]={status:'NOT_VERIFIED',value:null,reasonCode:'SOURCES_DISAGREE',...(f==='change24hPct'?{reason:REASONS.SOURCES_DISAGREE}:{}),sources:src,...meta};
   continue;
  }
  fields[f]={status:'SOURCE_REPORTED',value:has(g)?g:d,sources:src,...meta,...(m?{}:{crossCheck:state})};
 }
 const counts={CROSS_VERIFIED:0,SOURCE_REPORTED:0,NOT_VERIFIED:0};
 for(const v of Object.values(fields))counts[v.status]++;
 return {fields,counts,crossCheck:state,dexUrl:m?.url||null,logo:m?.logo||null};
}
const DAY=24*60*60*1000;
const REASONS=Object.freeze({
 POOL_LESS_THAN_24H_OLD:'Havuz 24 saatten yeni; sağlayıcı tam 24 saatlik değişimi bildirmedi. Değer tahmin edilmez.',
 SOURCE_24H_CHANGE_UNAVAILABLE:'Sağlayıcı bu havuz için 24 saatlik fiyat değişimini bildirmedi. Değer tahmin edilmez.',
 SOURCES_DISAGREE:'İki kaynak aynı havuz için 24 saatlik değişimde 3 puandan fazla ayrışıyor; doğrulanamadı.'
});
function explain(f,gt,m,opts){
 if(f==='change24hPct'){
  const t=Date.parse(gt.poolCreatedAt),now=typeof opts.now==='number'?opts.now:Date.now();
  const young=Number.isFinite(t)&&now-t<DAY;
  const code=young?'POOL_LESS_THAN_24H_OLD':'SOURCE_24H_CHANGE_UNAVAILABLE';
  return {reasonCode:code,reason:REASONS[code],...(young?{poolAgeHours:Math.max(0,Math.round((now-t)/36e5*10)/10)}:{})};
 }
 return {reasonCode:reasonFor(f,gt,m)};
}
function reasonFor(f,gt,m){
 if((f==='marketCapUsd')&&has(gt.fdvUsd))return 'MARKET_CAP_NOT_PROVIDED';   // FDV exists but is a different quantity and is never shown as market cap
 return 'FIELD_NOT_PROVIDED';
}
module.exports={REASONS,TOLERANCE,FIELDS,PAIR_CAP,agree,verifyRow,summarize};
