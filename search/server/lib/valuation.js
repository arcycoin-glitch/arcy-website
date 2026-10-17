'use strict';
// Full-supply valuation only. Never circulating supply or inferred market cap.
const {chain}=require('./chains');
function exactPrice(price,network,address){
 const cfg=chain(network);
 return price?.dataState==='DATA_FOUND'&&price.chainId===cfg.chainId&&price.network===network&&
  Number.isFinite(Number(price.value))&&Number(price.value)>0&&price.evidence?.some(e=>
   e.chainId===cfg.chainId&&e.network===network&&(e.address||e.token)?.toLowerCase()===address.toLowerCase());
}
function normalize(valuation,price,base,network){
 const address=base?.address,cfg=chain(network);
 if(typeof address!=='string'||!/^0x[0-9a-f]{40}$/i.test(address)||!exactPrice(price,network,address))return valuation;
 const raw=base.totalSupplyRaw,decimals=base.token?.decimals;
 if(typeof raw!=='string'||!/^[1-9]\d{0,77}$/.test(raw)||!Number.isInteger(decimals)||decimals<0||decimals>36||!/^0x[0-9a-f]+$/i.test(base.block||''))return valuation;
 const value=Number(BigInt(raw))*Number(price.value)/10**decimals;
 if(!Number.isFinite(value)||value<=0)return valuation;
 const existing=valuation?.dataState==='DATA_FOUND';
 // Never replace sound reported market cap/FDV just for cosmetic coverage.
 // A chain-scoped cap above the contract's full supply value is not defensible.
 if(existing&&(valuation.kind!=='MARKET_CAP'||Number(valuation.value)<=value*1.05))return valuation;
 return {value,kind:'FDV',status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:cfg.label+' RPC totalSupply × '+price.source,
  chainId:cfg.chainId,network,evidence:[{chainId:cfg.chainId,network,address,block:base.block,
   method:'Pinned totalSupply × exact-contract USD price',totalSupplyRaw:raw,decimals,
   scope:'Full-supply value (FDV), NOT circulating-supply market cap. Price may be a source-reported or on-chain oracle reference; not executable trade proceeds. Numeric display precision is IEEE-754.',
   priceEvidence:price.evidence,rejectedReportedMarketCap:existing?valuation.value:null}],
  freshness:price.freshness||null};
}
module.exports={normalize,exactPrice};
