'use strict';
const {inspect:inspectToken}=require('./eth');
const evidence=require('./evidence');
const market=require('./market');
const control=require('./control');
const holdersSource=require('./holders');
const circulation=require('./circulating');
const security=require('./goplus-evidence');
const schema=require('../schema');
const supplyInsights=require('./supply-insights');
function unavailable(description,fields){
 return evidence.card(Object.fromEntries(fields.map(([key,reason])=>[key,evidence.unknown(reason)])),description);
}
function copyFields(source,keys,description){
 return evidence.card(Object.fromEntries(keys.map(key=>[key,source.fields[key]||evidence.unknown('Metric adapter has not returned an evidence field.')])),description);
}
function burnAddressPercent(totalRaw,burnRaw,block,address){
 if(typeof totalRaw!=='string'||!/^[1-9][0-9]*$/.test(totalRaw)||typeof burnRaw!=='string'||!/^(0|[1-9][0-9]*)$/.test(burnRaw))
 return evidence.unknown('Standard burn-address share cannot be reconciled.','BURN_SHARE_NOT_VERIFIED');
 const supply=BigInt(totalRaw),burn=BigInt(burnRaw);
 if(supply<=0n||burn>supply)return evidence.unknown('Standard burn-address share cannot be reconciled.','BURN_SHARE_NOT_VERIFIED');
 const precision=10n**80n;
 const scaled=(burn*100n*precision+supply/2n)/supply;
 return evidence.found(Number(scaled)/1e80,'Ethereum RPC',[{chainId:1,block,address,method:'balanceOf(0x0 and 0xdead) / totalSupply()',scope:'Current balances only, not historic burned total.'}],'ON_CHAIN_DERIVED');
}
function mechanicsCard(controls,securityData={},getters={}){
 const owner=controls.fields?.owner;
 const proxy=controls.fields?.proxyImplementation;
 const ownerAdmin=owner?.dataState==='DATA_FOUND'
   ?{...owner,value:'owner() getter: '+owner.value,scope:'Getter-reported only. Does not prove the complete contract admin role model.'}
   :getters.ownerAdmin?.dataState==='DATA_FOUND'?getters.ownerAdmin:
    securityData.ownerAdmin?.dataState==='DATA_FOUND'?securityData.ownerAdmin:
    evidence.unknown('Owner/admin authority cannot be established from a missing getter. Role/implementation inspection needed.','OWNER_ADMIN_NOT_VERIFIED');
 const contractArchitecture=proxy?.dataState==='DATA_FOUND'
   ?{...proxy,value:'EIP-1967 implementation: '+proxy.value,scope:'An implementation slot is populated; verify admin, beacon, UUPS and delegatecall behavior separately.'}
   :getters.contractArchitecture?.dataState==='DATA_FOUND'?getters.contractArchitecture:
    securityData.contractArchitecture?.dataState==='DATA_FOUND'?securityData.contractArchitecture:
    evidence.unknown('No EIP-1967 implementation established; absence does not prove non-upgradeability.','ARCHITECTURE_NOT_VERIFIED');
 const result=evidence.card({
   tradingTaxes:securityData.tradingTaxes||securityData.taxes||evidence.unknown('No contract-matched source fee observation.','TRADING_TAXES_NOT_VERIFIED'),
   mintCapability:securityData.mintCapability||securityData.mint||evidence.unknown('Mint authority requires a verified source observation.','MINT_CAPABILITY_NOT_VERIFIED'),
   ownerAdmin,
   contractArchitecture
 },'Pinned getter/storage evidence with separately labelled GoPlus source-reported detections. No claim of complete role or authority enumeration.');
 result.controlEvidence=controls.fields;
 return result;
}
async function build(address){
 const t=await inspectToken(address);
 require('./progress').identity('ethereum',t);
 const onChain=x=>x?.status==='ON_CHAIN'?evidence.found(x.value,'Ethereum RPC',[{method:x.method,block:t.block,address:t.address}],'ON_CHAIN'):evidence.unknown(x?.reason||'No on-chain verification available.');
 const earlySupply=evidence.card({...supplyInsights.baseline('ethereum'),totalSupply:onChain(t.fields.totalSupply),circulatingSupply:evidence.unknown('Exact-contract circulation evidence pending.'),burnAddressBalance:onChain(t.fields.burnAddressBalance),burnAddressPct:burnAddressPercent(t.totalSupplyRaw,t.burnAddressRaw,t.block,t.address)},'Pinned-block on-chain supply and standard burn address balances.');
 require('./progress').card('ethereum',t,'supply',earlySupply);
 const marketWork=market.inspect(t.address,t.block).then(m=>{
  const liquidity=copyFields(m,['liquidityUsd','volume24h','dexPairCount','lpStatus'],'Exact-matched source-reported market data. LP permissions remain unverified.');
  const activity=copyFields(m,['priceUsd','valuation','change24h','volume24h'],'Exact-contract source-reported market observations.');
  activity.fields.valuation=require('./valuation').normalize(activity.fields.valuation,activity.fields.priceUsd,t,'ethereum');
  require('./progress').card('ethereum',t,'liquidity',liquidity);require('./progress').card('ethereum',t,'activity',activity);return m;
 });
 const controls=control.inspect(t.address,t.block).catch(control.failure);
 const securityWork=security.inspect('ethereum',t.address).catch(()=>({}));
 const mechanicsWork=(async()=>{
  const [c,sec]=await Promise.all([controls,securityWork]);let extra={};
  if(c.fields?.owner?.dataState!=='DATA_FOUND'||c.fields?.proxyImplementation?.dataState!=='DATA_FOUND'){
   try{extra=await require('./admin-getters').inspect({network:'ethereum',address:t.address,block:t.block,rpc:require('./eth').rpc,needAdmin:c.fields?.owner?.dataState!=='DATA_FOUND',needImplementation:c.fields?.proxyImplementation?.dataState!=='DATA_FOUND'})}catch{}
  }
  return require('./mechanics-deep').enrich({network:'ethereum',address:t.address,block:t.block,rpc:require('./eth').rpc,card:mechanicsCard(c,sec,extra)});
 })();
 // Independent verified cards must not wait for a slow holder/market provider.
 mechanicsWork.then(card=>require('./progress').card('ethereum',t,'mechanics',card)).catch(()=>{});
 const holderWork=holdersSource.inspect(t.address,t.block,t.totalSupplyRaw);
 holderWork.then(card=>require('./progress').card('ethereum',t,'holders',card)).catch(()=>{});
 const [marketResult,controlResult,holderResult,circulatingResult,securityResult,goPlusHolderResult]=await Promise.allSettled([
  marketWork,controls,
  holderWork,
  circulation.inspect(t.address,t.fields.totalSupply.value),
  securityWork,
  security.inspectHolders('ethereum',t.address)
 ]);
 const m=marketResult.status==='fulfilled'?marketResult.value:market.failure(marketResult.reason);
 const c=controlResult.status==='fulfilled'?controlResult.value:control.failure(controlResult.reason);
 const h=holderResult.status==='fulfilled'?holderResult.value:holdersSource.blank('Holder provider request failed.','SOURCE_API_FAILED');
 const circ=circulatingResult.status==='fulfilled'?circulatingResult.value:evidence.error(circulatingResult.reason,'Licensed circulation source');
 const sec=securityResult.status==='fulfilled'?securityResult.value:{};

 const supplyResearch=await supplyInsights.inspect({network:'ethereum',base:{address:t.address,block:t.block,chainId:1,network:'ethereum',totalSupplyRaw:t.totalSupplyRaw,burnAddressRaw:t.burnAddressRaw}});
 const supply=evidence.card({
   ...supplyResearch,
   totalSupply:onChain(t.fields.totalSupply),
   circulatingSupply:circ,
   burnAddressBalance:onChain(t.fields.burnAddressBalance),
   burnAddressPct:burnAddressPercent(t.totalSupplyRaw,t.burnAddressRaw,t.block,t.address)
 },'Pinned-block on-chain supply and standard burn address balances.');
 const goPlusHolders=goPlusHolderResult.status==='fulfilled'?goPlusHolderResult.value:{};
 const holders=copyFields(h,['holderCount','largestWalletPct','top10Pct','top20Pct'],
  'Blockscout source-ranked pinned balances where reconciled; GoPlus top-wallet samples are SOURCE_REPORTED only, not on-chain rank proofs.');
 for(const key of ['holderCount','largestWalletPct','top10Pct']){
  if(holders.fields[key]?.dataState!=='DATA_FOUND'&&goPlusHolders[key]?.dataState==='DATA_FOUND')
   holders.fields[key]=goPlusHolders[key];
 }
 if(Array.isArray(h.holderCandidates)&&h.holderCandidates.length)holders.holderCandidates=h.holderCandidates;
 if(Object.values(holders.fields).some(f=>f.dataState==='DATA_FOUND'))
  holders.status='PARTIAL_EVIDENCE';
 const liquidity=copyFields(m,['liquidityUsd','volume24h','dexPairCount','lpStatus'],'Exact-matched source-reported market data. LP permissions remain unverified.');
 const activity=copyFields(m,['priceUsd','valuation','change24h','volume24h'],'Primary base-token market values from exact Ethereum pairs; source-reported.');
 activity.fields.valuation=require('./valuation').normalize(activity.fields.valuation,activity.fields.priceUsd,t,'ethereum');
 const mechanics=await mechanicsWork;
 const cards={supply,holders,liquidity,activity,mechanics};
 for(const d of schema){
   if(!cards[d.id])throw Error('Missing required card '+d.id);
   for(const [key] of d.fields)if(!cards[d.id].fields[key])throw Error('Missing required field '+d.id+'.'+key);
 }
 return {
   ok:true,schemaVersion:1,cardCount:schema.length,chainId:1,network:'ethereum',
   address:t.address,scannedAt:t.scannedAt,block:t.block,token:t.token,cards,
   warnings:['Experimental prototype — not financial advice.','Market APIs report source values; they are not independently verified on-chain.','Missing evidence never becomes zero, false or a simulated value.']
 };
}
module.exports={build,copyFields,mechanicsCard,burnAddressPercent};
