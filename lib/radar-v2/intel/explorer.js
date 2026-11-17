'use strict';
// Radar Intelligence — Blockscout explorer evidence (Ethereum, Robinhood Chain). Arc has no Blockscout instance configured
// in ARCY (chains.js blockscoutTokens:null), so Arc contract evidence stays bytecode-only and is reported as such.
// Reads: /api/v2/smart-contracts/{address} (verification + ABI) and /api/v2/tokens/{address}/holders (first page only).
const F=require('./fetch');
const HOST=Object.freeze({ethereum:'https://eth.blockscout.com',robinhood:'https://robinhoodchain.blockscout.com',pons:'https://robinhoodchain.blockscout.com'});
// Mutating functions a plain fixed-supply ERC-20 may expose without giving anyone supply, freeze or fee powers.
const STANDARD_MUTATING=new Set(['transfer','transferFrom','approve','increaseAllowance','decreaseAllowance','permit','burn','burnFrom',
 'renounceOwnership','transferOwnership','acceptOwnership','delegate','delegateBySig']);
const DANGEROUS=/^(blacklist|addToBlacklist|setBlacklist|blockAccount|addBot|setBots?|setTax|setTaxes|setFee|setFees|setBuyFee|setSellFee|setBuyTax|setSellTax|setMaxTx|setMaxWallet|setTrading|enableTrading|disableTrading|setSwapEnabled)$/i;
const MINT=/^(mint|mintTo|_mint|issue)$/i,PAUSE=/^(pause|unpause|freeze)$/i;
function abiSurface(abi){
 const fns=(Array.isArray(abi)?abi:[]).filter(x=>x&&x.type==='function');
 const mutating=fns.filter(f=>!['view','pure'].includes(f.stateMutability)&&!(f.constant===true)).map(f=>String(f.name));
 return {mutating:[...new Set(mutating)].sort(),nonStandard:[...new Set(mutating.filter(n=>!STANDARD_MUTATING.has(n)))].sort(),
  hasCap:fns.some(f=>f.name==='cap'&&['view','pure'].includes(f.stateMutability)),hasMint:mutating.some(n=>MINT.test(n)),
  hasPause:mutating.some(n=>PAUSE.test(n)),dangerous:[...new Set(mutating.filter(n=>DANGEROUS.test(n)))].sort()};
}
async function contract({network,address,o}){
 const host=HOST[network];if(!host)return {ok:false,reason:'EXPLORER_NOT_CONFIGURED_FOR_NETWORK'};
 const url=host+'/api/v2/smart-contracts/'+address;
 const r=await F.json(url,o);
 if(r?.is_verified!==true)return {ok:true,verified:false,sourceUrl:host+'/address/'+address+'?tab=contract'};
 return {ok:true,verified:true,name:String(r.name||'').slice(0,80),compiler:String(r.compiler_version||'').slice(0,60),proxyType:r.proxy_type||null,
  implementations:Array.isArray(r.implementations)?r.implementations.slice(0,3).map(i=>String(i.address_hash||i.address||'').toLowerCase()):[],
  surface:abiSurface(r.abi),sourceUrl:host+'/address/'+address+'?tab=contract'};
}
async function holders({network,address,o,exclude=[]}){
 const host=HOST[network];if(!host)return {ok:false,reason:'EXPLORER_NOT_CONFIGURED_FOR_NETWORK'};
 const [info,page]=[await F.json(host+'/api/v2/tokens/'+address,o),await F.json(host+'/api/v2/tokens/'+address+'/holders',o)];
 const supply=Number(info?.total_supply),items=Array.isArray(page?.items)?page.items:[];
 if(!(supply>0)||!items.length)return {ok:false,reason:'HOLDERS_NOT_AVAILABLE'};
 const skip=new Set(['0x0000000000000000000000000000000000000000','0x000000000000000000000000000000000000dead',...exclude.map(x=>String(x).toLowerCase())]);
 const eoa=items.filter(i=>i?.address?.hash&&!skip.has(String(i.address.hash).toLowerCase())&&i.address.is_contract!==true);
 const largest=eoa.length?Math.max(...eoa.map(i=>Number(i.value)||0))/supply:null;
 const top10=eoa.slice(0,10).reduce((s,i)=>s+(Number(i.value)||0),0)/supply;
 return {ok:true,holdersCount:Number(info.holders_count??info.holders)||null,largestEoaShare:largest,top10EoaShare:top10,scope:'first holders page; contracts (pools, lockers, managers) and burn addresses excluded',
  sourceUrl:host+'/token/'+address+'?tab=holders'};
}
module.exports={contract,holders,abiSurface,HOST,STANDARD_MUTATING};
