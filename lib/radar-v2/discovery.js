'use strict';
// ARCY Radar V3 — discovery rules: asset-identity exclusion and the ARCY Discovery Score.
// Pure functions, no I/O. Everything here is deterministic, explainable and derived only from provider data that is present:
// a missing input removes its score component (the remaining weights are re-normalised and the loss is reported); nothing is estimated.
// ARCY's own algorithm: it does not copy or approximate any other site's ranking.

const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const DAY=86400000;
const logScale=(v,min,ref)=>finite(v)&&v>0?clamp(Math.log10(v/min)/Math.log10(ref/min)):0;

// ── per-network profiles ────────────────────────────────────────────────────────────────────────
// Floors (minimum to be a discovery candidate) and references (value that earns a full component) differ by chain depth.
// A $20k-volume token is meaningful on a young chain and noise on Ethereum, so absolute thresholds are never shared.
const PROFILES=Object.freeze({
 ethereum:Object.freeze({minVol:100000,minLiq:200000,refVol:50e6,refLiq:20e6,refTx:20000}),
 robinhood:Object.freeze({minVol:10000,minLiq:25000,refVol:2e6,refLiq:1e6,refTx:3000}),
 arc:Object.freeze({minVol:5000,minLiq:20000,refVol:1e6,refLiq:1e6,refTx:2000}),
 pons:Object.freeze({minVol:1000,minLiq:3000,refVol:3e5,refLiq:1e5,refTx:1000})
});
const WEIGHTS=Object.freeze({volume:20,liquidity:15,freshness:20,activity:15,momentum:10,consistency:10,balance:5,breadth:5});
// Pons Launch prioritises fresh launches with real trades.
const WEIGHTS_PONS=Object.freeze({volume:20,liquidity:10,freshness:25,activity:20,momentum:5,consistency:10,balance:5,breadth:5});
const LEGACY_DAYS=180,CAPS=Object.freeze({legacy:4,tokenizedEquity:2});
const SCORE_VERSION='arcy-discovery-1';

// ── identity ────────────────────────────────────────────────────────────────────────────────────
const ZERO='0x0000000000000000000000000000000000000000';
// Canonical base / stable / liquid-staking assets on Ethereum mainnet, by contract. Matching by address is the strongest identity proof.
const CANONICAL=Object.freeze({
 ethereum:new Map(Object.entries({
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2':'WRAPPED_BASE_ASSET','0x2260fac5e5542a773aa44fbcfedf7c193bc2c599':'WRAPPED_BASE_ASSET','0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf':'WRAPPED_BASE_ASSET',
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84':'WRAPPED_BASE_ASSET','0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0':'WRAPPED_BASE_ASSET','0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee':'WRAPPED_BASE_ASSET','0xae78736cd615f374d3085123a210448e74fc6393':'WRAPPED_BASE_ASSET',
  '0xdac17f958d2ee523a2206206994597c13d831ec7':'STABLECOIN','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':'STABLECOIN','0x6b175474e89094c44da98b954eedeac495271d0f':'STABLECOIN','0xf939e0a03fb07f59a73314e73794be0e57ac1b4e':'STABLECOIN',
  '0x4c9edd5852cd905f086c759e8383e09bff1e68b3':'STABLECOIN','0x9d39a5de30e57443bff2a8307a4256c8797a3497':'STABLECOIN','0xdc035d45d973e3ec169d2276ddab16f1e407384f':'STABLECOIN','0x6c3ea9036406852006290770bedfcaba0e23a0e8':'STABLECOIN',
  '0x8292bb45bf1ee4d140127049757c2e0ff06317ed':'STABLECOIN','0x1abaea1f7c830bd89acc67ec4af516284b1bc33c':'STABLECOIN','0x0000000000085d4780b73119b644ae5ecd22b376':'STABLECOIN','0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f':'STABLECOIN'
 })),
 // Robinhood Chain's WETH is the official one named by the pons documentation (sources.PONS.weth).
 robinhood:new Map(Object.entries({'0x0bd7d308f8e1639fab988df18a8011f41eacad73':'WRAPPED_BASE_ASSET'})),
 arc:new Map(),pons:new Map()
});
// CoinGecko-curated identity (coingecko_coin_id from the provider): ids of base / stable assets.
const COIN_BASE=/^(weth|wrapped-bitcoin|wrapped-steth|staked-ether|wrapped-eeth|wrapped-ether|coinbase-wrapped-btc|circle-wrapped-btc|ethereum|bitcoin|wrapped-.*(?:btc|bitcoin|eth|ether))$/;
const COIN_STABLE=/(^|-)(usd|usdc|usdt|eur|euro|eurc)(-|$)|stablecoin|^(tether|usd-coin|dai|global-dollar|paypal-usd|first-digital-usd|ripple-usd|ethena-usd|frax|true-usd|gemini-dollar|pax-dollar|paxos-standard|liquity-usd|crvusd|gho)$/;
const ETH_RE=/^(w?eth|steth|wsteth|weeth|reth|cbeth|ezeth|rseth|sfrxeth|oseth|wrseth)$/i;
const BTC_RE=/^(w?btc|cbbtc|cirbtc|tbtc|lbtc|solvbtc|ebtc|wbtc\.e)$/i;
const ETH_NAME=/(^|\b)(wrapped|staked|circle wrapped|coinbase wrapped)\s+(ether|eth)\b|^ether$|^ethereum$/i;
const BTC_NAME=/(^|\b)(wrapped|staked|circle wrapped|coinbase wrapped)\s+(bitcoin|btc)\b|^bitcoin$/i;
const MAJOR_STABLE_SYMBOLS=new Set(['usdt','usdc','dai','usde','susde','usds','usdg','usdb','pyusd','rlusd','eurc','fdusd','tusd','usdp','gusd','lusd','crvusd','gho','frax','usdt0','usd₮0']);
const STABLE_LOOKS=(s,n)=>/^(usd[a-z0-9]{0,4}|[a-z0-9]{1,3}usd[a-z0-9]{0,2}|eur[a-z]{0,2}|[a-z]{1,2}eur[a-z]?)$/i.test(s)||/(^|\s)(usd|us dollar|dollar|euro|eur|stablecoin)(\s|$)/i.test(n);
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

// Reference USD prices for ETH-like and BTC-like assets on one chain. Built from the chain's OWN candidates: the registry/official asset
// if present, else the median of ETH-ish tickers when at least three agree (a lone outlier cannot define the reference).
function referencePrices(network,cands){
 const reg=CANONICAL[network]||new Map();
 const out={eth:null,btc:null};
 for(const [key,re,nameRe] of [['eth',ETH_RE,ETH_NAME],['btc',BTC_RE,BTC_NAME]]){
  const priced=cands.filter(c=>finite(c.priceUsd)&&c.priceUsd>0&&(re.test(c.symbol)||nameRe.test(c.name)));
  const known=priced.filter(c=>reg.get(c.address)==='WRAPPED_BASE_ASSET'&&(key==='eth'?ETH_RE.test(c.symbol):BTC_RE.test(c.symbol)));
  if(known.length)out[key]=median(known.map(c=>c.priceUsd));
  else if(priced.length>=3){const m=median(priced.map(c=>c.priceUsd)),near=priced.filter(c=>Math.abs(c.priceUsd/m-1)<=0.25);if(near.length>=3)out[key]=median(near.map(c=>c.priceUsd));}
 }
 return out;
}
// -> null (eligible by identity) | {reason, detail}. Exclusion applies to the DISCOVERY ranking only; search and contract review are untouched.
function classify(row,network,ref={eth:null,btc:null}){
 const a=row.address,sym=row.symbol||'',name=row.name||'',price=row.priceUsd,chg=row.change24hPct;
 if(!/^0x[0-9a-f]{40}$/i.test(a)||a===ZERO)return {reason:'NATIVE_PLACEHOLDER',detail:'Zero address / native-asset placeholder, not a token contract.'};
 const reg=(CANONICAL[network]||new Map()).get(a);
 if(reg)return {reason:reg,detail:'Canonical asset matched by contract address on this chain.'};
 const coin=row.coinId||'';
 const symL=sym.toLowerCase();
 const isEth=ETH_RE.test(sym)||ETH_NAME.test(name),isBtc=BTC_RE.test(sym)||BTC_NAME.test(name);
 if(coin&&COIN_BASE.test(coin))return {reason:'WRAPPED_BASE_ASSET',detail:'CoinGecko coin id "'+coin+'" is a base/wrapped asset.'};
 if(coin&&COIN_STABLE.test(coin))return {reason:'STABLECOIN',detail:'CoinGecko coin id "'+coin+'" is a stablecoin.'};
 if(isEth||isBtc){
  const r=isEth?ref.eth:ref.btc;
  if(finite(price)&&r&&price/r>=0.6&&price/r<=1.6)return {reason:'WRAPPED_BASE_ASSET',detail:'Ticker/name of a base asset with a price consistent with the chain\'s '+(isEth?'ETH':'BTC')+' reference (x'+(price/r).toFixed(2)+').'};
  return {reason:'IMPERSONATION_SUSPECT',detail:'Uses a base-asset ticker/name without identity proof'+(r?' and its price is not consistent with the chain\'s reference':' (no reference price available)')+'. A ticker alone is not identity.'};
 }
 if(STABLE_LOOKS(sym,name)||MAJOR_STABLE_SYMBOLS.has(symL)){
  if(finite(price)&&price>=0.75&&price<=1.4&&(!finite(chg)||Math.abs(chg)<=8))return {reason:'STABLECOIN',detail:'Stable-asset name with a price held near a currency peg ($'+price.toFixed(3)+', 24h '+(finite(chg)?chg.toFixed(2)+'%':'n/a')+').'};
  if(MAJOR_STABLE_SYMBOLS.has(symL))return {reason:'IMPERSONATION_SUSPECT',detail:'Uses a major stablecoin ticker without holding its peg or identity proof.'};
 }
 return null;
}
// provider names are cut at 70 chars ("… Class A Common Stock • Robinhood "), so the bullet + brand is the stable marker
const isTokenizedEquity=row=>/(\u2022|\bRobinhood Token\b)\s*Robinhood/i.test(row.name||'')||/\bRobinhood Token\b/i.test(row.name||'');

// ── gates (hard eligibility) ────────────────────────────────────────────────────────────────────
function txCount(r){return finite(r.buys24h)&&finite(r.sells24h)?r.buys24h+r.sells24h:null;}
function gates(r,profile){
 const why=[];
 if(!(finite(r.priceUsd)&&r.priceUsd>0))why.push('PRICE_NOT_VERIFIED');
 else if(r.priceUsd>1e12||r.priceUsd<1e-18)why.push('PRICE_IMPLAUSIBLE');
 if(!finite(r.volume24hUsd))why.push('VOLUME_NOT_VERIFIED');else if(r.volume24hUsd<profile.minVol)why.push('VOLUME_BELOW_NETWORK_FLOOR');
 if(!finite(r.liquidityUsd))why.push('LIQUIDITY_NOT_VERIFIED');else if(r.liquidityUsd<profile.minLiq)why.push('LIQUIDITY_BELOW_NETWORK_FLOOR');
 if(finite(r.volume24hUsd)&&finite(r.liquidityUsd)&&r.liquidityUsd>0&&r.volume24hUsd/r.liquidityUsd>1000)why.push('VOLUME_LIQUIDITY_INCONSISTENT');
 const tx=txCount(r);
 if(tx!==null&&tx<10)why.push('TOO_FEW_TRADES');
 return why;
}
function ageDays(r,now){const t=Date.parse(r.ageIso!==undefined?r.ageIso:r.poolCreatedAt);return Number.isFinite(t)?Math.max(0,(now-t)/DAY):null;}
const freshnessOf=d=>d<=2?1:d<=7?0.85:d<=14?0.7:d<=30?0.55:d<=90?0.35:d<=365?0.2:0.1;
const usd=n=>n>=1e9?'$'+(n/1e9).toFixed(2)+'B':n>=1e6?'$'+(n/1e6).toFixed(2)+'M':n>=1e3?'$'+(n/1e3).toFixed(1)+'k':'$'+n.toFixed(0);

// ── ARCY Discovery Score ────────────────────────────────────────────────────────────────────────
// r: {volume24hUsd, liquidityUsd, change24hPct, buys24h, sells24h, poolCreatedAt, scopeVolume, crossShare|null}
// -> {score 0..100 over the available weight, components[], missing[], flags[], weightCoverage}
function score(r,network,now,{pons=false}={}){
 const p=PROFILES[network]||PROFILES.robinhood,W=pons?WEIGHTS_PONS:WEIGHTS,comps=[],missing=[],flags=[];
 const add=(id,v,basis)=>{comps.push({id,weight:W[id],value:+v.toFixed(4),basis});};
 const miss=(id,why)=>missing.push({id,weight:W[id],why});
 add('volume',logScale(r.volume24hUsd,p.minVol,p.refVol),'24h volume '+usd(r.volume24hUsd)+' ('+(r.scopeVolume==='TOKEN'?'token total':'top pool')+') vs network floor '+usd(p.minVol)+' / reference '+usd(p.refVol));
 add('liquidity',logScale(r.liquidityUsd,p.minLiq,p.refLiq),'liquidity '+usd(r.liquidityUsd)+' vs network floor '+usd(p.minLiq)+' / reference '+usd(p.refLiq));
 const age=ageDays(r,now);
 if(age!==null)add('freshness',freshnessOf(age),'top pool age '+(age<1?'<1':Math.floor(age))+' d'+(r.poolAgeBasis==='SOURCES_DISAGREE_OLDER_USED'?' (providers disagree; the older date is used)':''));
 else add('freshness',0,'pool age not available: no freshness credit (newness needs evidence; weight kept, not re-distributed)');
 const tx=txCount(r);
 if(tx!==null)add('activity',logScale(Math.max(tx,1),5,p.refTx),tx+' trades in 24h (buys '+r.buys24h+', sells '+r.sells24h+')');else miss('activity','TRADE_COUNT_NOT_PROVIDED');
 if(finite(r.change24hPct)){
  const c=r.change24hPct;let v=c<=-50?0:c<0?0.4*(1+c/50):c<=100?0.4+0.6*(c/100):c<=300?1:0.6;
  if(c>300)flags.push('EXTREME_PUMP_24H');
  add('momentum',clamp(v),'24h price change '+c.toFixed(2)+'%');
 }else miss('momentum','PRICE_CHANGE_NOT_VERIFIED');
 if(r.crossShare!==null&&r.crossShare!==undefined)add('consistency',clamp(r.crossShare),'share of price/volume/liquidity independently cross-verified: '+Math.round(r.crossShare*100)+'%');
 else miss('consistency','NO_SECOND_SOURCE');
 if(tx!==null&&tx>=50&&r.buys24h+r.sells24h>0){const b=Math.min(r.buys24h,r.sells24h)/Math.max(r.buys24h,r.sells24h,1);add('balance',clamp(b/0.5),'buy/sell balance '+r.buys24h+'/'+r.sells24h);}
 else miss('balance','TOO_FEW_TRADES_TO_JUDGE_BALANCE');
 if(r.scopeVolume==='TOKEN'&&finite(r.volume24hUsd)&&finite(r.poolVolume24hUsd)&&r.poolVolume24hUsd>0){
  const share=r.poolVolume24hUsd/r.volume24hUsd;
  add('breadth',share>=0.9?0.3:share>=0.6?0.7:1,'top pool carries '+Math.round(Math.min(share,1)*100)+'% of the token\'s 24h volume');
  if(share>=0.9)flags.push('SINGLE_POOL_CONCENTRATION');
 }else miss('breadth','TOKEN_LEVEL_VOLUME_NOT_AVAILABLE');
 const total=comps.reduce((a,c)=>a+c.weight,0),got=comps.reduce((a,c)=>a+c.weight*c.value,0);
 let s=total?100*got/total:0;
 // anomaly penalties: evidence-based, never an accusation
 const penalties=[];
 const turn=finite(r.volume24hUsd)&&finite(r.liquidityUsd)&&r.liquidityUsd>0?r.volume24hUsd/r.liquidityUsd:null;
 if(turn!==null&&turn>100){penalties.push({id:'HIGH_TURNOVER',points:15,basis:'24h volume is '+turn.toFixed(0)+'x liquidity'});flags.push('HIGH_TURNOVER');}
 if(tx!==null&&tx>0&&tx<30&&finite(r.volume24hUsd)&&r.volume24hUsd/tx>50000){penalties.push({id:'LARGE_TRADES_FEW_TXNS',points:10,basis:usd(r.volume24hUsd/tx)+' average per trade over only '+tx+' trades'});flags.push('LARGE_TRADES_FEW_TXNS');}
 if(tx!==null&&tx>=50&&Math.min(r.buys24h,r.sells24h)/Math.max(r.buys24h,r.sells24h,1)<0.1){penalties.push({id:'ONE_SIDED_FLOW',points:5,basis:'buys '+r.buys24h+' vs sells '+r.sells24h});flags.push('ONE_SIDED_FLOW');}
 s=clamp(s-penalties.reduce((a,x)=>a+x.points,0),0,100);
 return {score:+s.toFixed(1),version:SCORE_VERSION,components:comps.map(c=>({...c,points:+(c.weight*c.value*100/total).toFixed(2)})),missing,penalties,flags,weightCoverage:+(total/Object.values(W).reduce((a,b)=>a+b,0)).toFixed(3)};
}
function reasonText(r,sc,age,kind){
 const parts=[];
 if(age!==null&&age<=14)parts.push('new pool ('+(age<1?'<1':Math.floor(age))+' d)');
 else if(age!==null&&age<=90)parts.push('recent pool ('+Math.floor(age)+' d)');
 if(finite(r.volume24hUsd))parts.push('24h volume '+usd(r.volume24hUsd));
 if(finite(r.liquidityUsd))parts.push('liquidity '+usd(r.liquidityUsd));
 const tx=txCount(r);if(tx!==null)parts.push(tx+' trades');
 const x=sc.components.find(c=>c.id==='consistency');if(x&&x.value>=0.66)parts.push('independently cross-verified');
 if(sc.flags.length)parts.push('watch: '+sc.flags.join(', '));
 if(kind==='TOKENIZED_EQUITY')parts.push('tokenized equity');
 return parts.join('; ');
}
// ── list assembly ───────────────────────────────────────────────────────────────────────────────
// Same-symbol contracts on one chain: the one with stronger identity evidence (official factory, then CoinGecko coin id, then score) stays;
// the rest are duplicates / look-alikes. Returns {kept, dropped:[{row,reason,detail}]}.
function dedupe(rows){
 const groups=new Map();
 for(const r of rows){const k=(r.symbol||'').toLowerCase();if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 const kept=[],dropped=[];
 for(const g of groups.values()){
  g.sort((a,b)=>(b._pons?1:0)-(a._pons?1:0)||(b.coinId?1:0)-(a.coinId?1:0)||(b.discovery?.score||0)-(a.discovery?.score||0)||a.address.localeCompare(b.address));
  kept.push(g[0]);
  for(const d of g.slice(1))dropped.push({row:d,reason:'DUPLICATE_SYMBOL_UNVERIFIED',detail:'Shares the ticker "'+g[0].symbol+'" with '+g[0].address+', which has stronger identity evidence ('+(g[0]._pons?'official pons factory':g[0].coinId?'CoinGecko coin id':'higher score')+'). A ticker alone is not identity.'});
 }
 return {kept,dropped};
}
// Anti-domination caps: old large assets and tokenized equities cannot fill the list while newer qualifying candidates exist.
// Soft caps: candidates held back by a cap are re-admitted (in score order) ONLY to fill places that would otherwise stay empty,
// so the cap never shrinks a list below what the eligible tokens can fill. Input must be sorted by score desc.
function diversify(sorted,limit,now){
 const out=[],held=[];let legacy=0,equity=0;
 for(const r of sorted){
  if(out.length>=limit)break;
  const age=ageDays(r,now),isLegacy=age!==null&&age>LEGACY_DAYS,isEq=r.kind==='TOKENIZED_EQUITY';
  if(isEq&&equity>=CAPS.tokenizedEquity){held.push({row:r,reason:'DIVERSITY_CAP_TOKENIZED_EQUITY',detail:'At most '+CAPS.tokenizedEquity+' tokenized equities per list while other qualifying tokens exist.'});continue;}
  if(isLegacy&&legacy>=CAPS.legacy){held.push({row:r,reason:'DIVERSITY_CAP_ESTABLISHED',detail:'At most '+CAPS.legacy+' tokens whose top pool is older than '+LEGACY_DAYS+' days per list while other qualifying tokens exist.'});continue;}
  if(isEq)equity++;if(isLegacy)legacy++;out.push(r);
 }
 const dropped=[];
 for(const h of held){
  if(out.length<limit&&!out.includes(h.row)){h.row.diversityBackfill=true;out.push(h.row);}
  else dropped.push(h);
 }
 const rank=new Map(sorted.map((r,i)=>[r,i]));
 out.sort((a,b)=>rank.get(a)-rank.get(b));
 return {out,dropped};
}
module.exports={PROFILES,WEIGHTS,WEIGHTS_PONS,CAPS,LEGACY_DAYS,SCORE_VERSION,CANONICAL,referencePrices,classify,isTokenizedEquity,gates,txCount,ageDays,score,reasonText,dedupe,diversify};
