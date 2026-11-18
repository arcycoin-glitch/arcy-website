'use strict';
// Radar V4 — asset category classification (exact chainId + contract, never ticker alone).
// Separates assets that may legitimately trade on Radar but are NOT undiscovered early-stage projects:
// stablecoins, wrapped/base assets, commodity-backed tokens, tokenized equities, established blue chips and legacy memes.
// Order: exact-contract lists (strongest) → existing contract-aware Radar identity rules → measured market maturity.
const D=require('../discovery');
const MAP=(o)=>new Map(Object.entries(o));
// Ethereum mainnet contracts (canonical deployments; addresses are the identity, symbols are labels only).
const EXACT=Object.freeze({
 1:MAP({
  '0x68749665ff8d2d112fa859aa293f07a622782f38':['COMMODITY_BACKED','XAUt (Tether Gold)'],
  '0x45804880de22913dafe09f4980848ece6ecbaf78':['COMMODITY_BACKED','PAXG (Paxos Gold)'],
  '0x6982508145454ce325ddbe47a25d4ec3d2311933':['LEGACY_MEME','PEPE'],
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce':['LEGACY_MEME','SHIB'],
  '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e':['LEGACY_MEME','FLOKI'],
  '0xaaee1a9723aadb7afa2810263653a34ba2c21c7a':['LEGACY_MEME','MOG'],
  '0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c':['LEGACY_MEME','SPX6900'],
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9':['ESTABLISHED_BLUE_CHIP','AAVE'],
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984':['ESTABLISHED_BLUE_CHIP','UNI'],
  '0x514910771af9ca656af840dff83e8264ecf986ca':['ESTABLISHED_BLUE_CHIP','LINK'],
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2':['ESTABLISHED_BLUE_CHIP','MKR'],
  '0x56072c95faa701256059aa122697b133aded9279':['ESTABLISHED_BLUE_CHIP','SKY'],
  '0x5a98fcbea516cf06857215779fd812ca3bef1b32':['ESTABLISHED_BLUE_CHIP','LDO'],
  '0x57e114b691db790c35207b2e685d4a43181e6061':['ESTABLISHED_BLUE_CHIP','ENA'],
  '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3':['ESTABLISHED_BLUE_CHIP','ONDO'],
  '0xd533a949740bb3306d119cc777fa900ba034cd52':['ESTABLISHED_BLUE_CHIP','CRV'],
  '0xb50721bcf8d664c30412cfbc6cf7a15145234ad1':['ESTABLISHED_BLUE_CHIP','ARB (Ethereum)'],
  // Verified on eth.blockscout.com 2026-11-18: "Rainbow Bridged Near (Ethereum)", verified source, 24 decimals.
  // Verified on the issuer's site doma.io 2026-11-18: gdollar (GDLR) "backed 1:1 by bars", exact contract published.
  '0xa038a26bf960451b8ce75ec4c92013c6307f8e4e':['COMMODITY_BACKED','GDLR (Doma gold-backed token)'],
  // Verified on pearlbridge.xyz 2026-11-18: WPRL is the Ethereum-side wrapper of PRL from the Pearl bridge.
  '0x07696dcab55e62cfef953666b29fe1970518cb00':['WRAPPED_OR_BASE_ASSET','WPRL (bridge wrapper of PRL)'],
  '0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4':['BRIDGED_ESTABLISHED_ASSET','NEAR (Rainbow Bridge representation of the NEAR L1 asset)']
 }),
 5042:new Map(),4663:new Map()
});
const CLASSIFY_TO_CATEGORY=Object.freeze({STABLECOIN:'STABLECOIN',WRAPPED_BASE_ASSET:'WRAPPED_OR_BASE_ASSET',IMPERSONATION_SUSPECT:'IMPERSONATION_SUSPECT',
 NATIVE_PLACEHOLDER:'INVALID_CONTRACT',ISSUER_AFFILIATION_NOT_VERIFIED:'UNVERIFIED_ISSUER_BRAND'});
const EARLY='EARLY_STAGE_CANDIDATE';
const NON_EARLY=new Set(['BRIDGED_ESTABLISHED_ASSET','STABLECOIN','WRAPPED_OR_BASE_ASSET','COMMODITY_BACKED','TOKENIZED_EQUITY','ESTABLISHED_BLUE_CHIP','LEGACY_MEME','ESTABLISHED_LARGE_CAP','MATURE_LEGACY_MARKET']);
const BLOCKED=new Set(['IMPERSONATION_SUSPECT','INVALID_CONTRACT','UNVERIFIED_ISSUER_BRAND','MAJOR_ASSET_TICKER_WITHOUT_IDENTITY','COMMODITY_TICKER_WITHOUT_IDENTITY']);
// Tickers of established L1/L2 assets (same list as the Radar new-pool identity flag). On a chain where the asset is not
// native, a contract using one of these tickers is EITHER an exact, listed bridged representation (non-early) OR it has no
// identity proof (blocked). It is never an "undiscovered early-stage project" by default.
const MAJOR_TICKERS=new Set(['btc','sol','xrp','ada','sui','doge','trx','bnb','avax','ton','dot','ltc','bch','xlm','hbar','apt','near','atom','arb','op','matic','pol','trump']);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
// Measured maturity thresholds (documented in docs/audits/radar-v4-opportunity-279.md): a contract whose own market already
// shows >= $1B FDV/market cap, or a >=365-day-old top pool with >= $1M liquidity, is established — not undiscovered.
const LARGE_CAP_USD=1e9,LEGACY_POOL_DAYS=365,LEGACY_LIQ_USD=1e6;
function classify(row,network,now=Date.now()){
 const chainId=Number(row?.chainId),a=String(row?.address||'').toLowerCase();
 const exact=EXACT[chainId]?.get(a);
 if(exact)return {category:exact[0],basis:'EXACT_CONTRACT_LIST',detail:exact[1]+' matched by chain '+chainId+' contract '+a};
 const k=D.classify({...row,address:a},network==='pons'?'robinhood':network);
 if(k)return {category:CLASSIFY_TO_CATEGORY[k.reason]||k.reason,basis:'RADAR_IDENTITY_RULES',detail:k.detail};
 const sym=String(row?.symbol||'').trim().toLowerCase().replace(/^\$/,'');
 // A provider name that declares a wrapper is a representation of another asset (conservative: only ever removes from early-stage).
 if(/^wrapped\s+\S/i.test(String(row?.name||'').trim()))return {category:'WRAPPED_OR_BASE_ASSET',basis:'PROVIDER_NAME_DECLARES_WRAPPER',detail:'Provider name declares a wrapped representation ('+String(row.name).slice(0,40)+').'};
 // Commodity tickers (gold/silver) without an exact issuer record: never an early-stage project.
 if(/^(xau[a-z0-9]{0,2}|paxg|xag[a-z0-9]{0,2}|pxau|kau|kag)$/.test(sym))return {category:'COMMODITY_TICKER_WITHOUT_IDENTITY',basis:'COMMODITY_TICKER_NOT_IN_EXACT_LIST',detail:'Uses a precious-metal ticker ('+sym.toUpperCase()+') without an exact issuer record on chain '+chainId+'.'};
 if(MAJOR_TICKERS.has(sym))return {category:'MAJOR_ASSET_TICKER_WITHOUT_IDENTITY',basis:'MAJOR_TICKER_NOT_IN_EXACT_LIST',detail:'Uses the ticker of an established asset ('+sym.toUpperCase()+') without an exact-contract identity record on chain '+chainId+'.'};
 const tokenizedFund=/\b(ondo tokenized|tokenized (stock|equity|etf|fund|bond|treasury))\b|\b(etf|shares|treasury bond)\b.*\btokenized\b/i.test(String(row?.name||''));
 if(D.isTokenizedEquity(row)||tokenizedFund)return {category:'TOKENIZED_EQUITY',basis:'ISSUER_MARKER_IN_PROVIDER_NAME',detail:'Tokenized equity representation (Robinhood token marker).'};
 const cap=Math.max(finite(row.fdvUsd)?row.fdvUsd:0,finite(row.marketCapUsd)?row.marketCapUsd:0);
 if(cap>=LARGE_CAP_USD)return {category:'ESTABLISHED_LARGE_CAP',basis:'MEASURED_MARKET_SIZE',detail:'Exact-contract FDV/market cap $'+Math.round(cap/1e6)+'M >= $1B.'};
 const age=D.ageDays(row,now);
 if(age!==null&&age>=LEGACY_POOL_DAYS&&finite(row.liquidityUsd)&&row.liquidityUsd>=LEGACY_LIQ_USD)
  return {category:'MATURE_LEGACY_MARKET',basis:'MEASURED_POOL_AGE_AND_LIQUIDITY',detail:'Top pool '+Math.floor(age)+' days old with $'+Math.round(row.liquidityUsd/1e6)+'M liquidity.'};
 return {category:EARLY,basis:'NO_NON_EARLY_SIGNAL',detail:'No contract-level evidence that this is an established, stable, wrapped, commodity or equity asset.'};
}
const isEarly=c=>c?.category===EARLY;
module.exports={classify,isEarly,EXACT,NON_EARLY,BLOCKED,MAJOR_TICKERS,EARLY,LARGE_CAP_USD,LEGACY_POOL_DAYS,LEGACY_LIQ_USD};
