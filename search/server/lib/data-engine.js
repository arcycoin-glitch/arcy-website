'use strict';
// Optional, adapter-injected multichain orchestration foundation.
// The existing Ethereum report/API are untouched until a full Codex audit.
// All source-backed fields must identify the exact network; otherwise they fail closed.
const schema=require('../schema');
const {chain}=require('./chains');
const {safeLogoUrl}=require('./token-image');
const derived=require('./derived-metrics');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const VALID_STATES=new Set(['DATA_FOUND','NOT_VERIFIED','SOURCE_API_FAILED']);
const SCHEMA_KEYS=new Map(schema.map(c=>[c.id,c.fields.map(([key])=>key)]));
function missing(reason='Reliable evidence unavailable.',reasonCode='INSUFFICIENT_EVIDENCE',network=null){
 return {value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',source:null,
  reason,reasonCode,network,evidence:[]};
}
function validateField(input,cfg){
 if(!input||typeof input!=='object'||!VALID_STATES.has(input.dataState))
  return missing('Unsupported or malformed evidence field.','INVALID_EVIDENCE',cfg.id);
 if(input.dataState==='DATA_FOUND'){
  if(input.value===null||input.value===undefined||
   (typeof input.value==='number'&&!Number.isFinite(input.value))||
   input.chainId!==cfg.chainId||input.network!==cfg.id||
   typeof input.source!=='string'||!input.source.trim()||
   !Array.isArray(input.evidence)||input.evidence.length===0)
   return missing('Provider did not prove this value belongs to the requested chain.','SOURCE_IDENTITY_MISMATCH',cfg.id);
  return {...input,network:cfg.id,chainId:cfg.chainId};
 }
 // Unverified provider output may never contain a usable value.
 return {...input,value:null,status:'NOT_VERIFIED',network:cfg.id,
  chainId:cfg.chainId,evidence:[],reasonCode:input.reasonCode||'INSUFFICIENT_EVIDENCE'};
}
function formatCard(cardId,raw,cfg,context){
 const keys=SCHEMA_KEYS.get(cardId);
 if(!keys)throw Error('Invalid card');
 const source=raw&&typeof raw==='object'&&raw.fields&&typeof raw.fields==='object'?raw.fields:{};
 // Derive display-only metrics from the already received source snapshot.
 // The originals (including exact issuer circulation and unlock research)
 // remain available for existing research context and audit consumers.
 const identity={network:cfg.id,chainId:cfg.chainId,address:context?.address,block:context?.block};
 const visible=cardId==='supply'?{...source,...derived.supply(source,identity)}:
  cardId==='liquidity'?{...source,liquidityTurnover24h:derived.liquidity(source,identity)}:source;
 const fields=Object.fromEntries(keys.map(key=>{
  const field=validateField(visible[key],cfg),proof=field.evidence?.[0];
  // Auxiliary implementation/authority observations may name other addresses;
  // the primary metric proof must never explicitly name a different token.
  const identity=proof?.address||proof?.token||proof?.contract;
  if(context&&field.dataState==='DATA_FOUND'&&typeof identity==='string'&&ADDRESS.test(identity)&&identity.toLowerCase()!==context.address.toLowerCase())
   return [key,missing('Primary evidence belongs to another token contract.','SOURCE_CONTRACT_MISMATCH',cfg.id)];
  const historical=field.status==='HISTORICAL_ONCHAIN_VERIFIED'||field.freshness?.state==='LAST_VERIFIED';
  if(context&&!historical&&/^(ON_CHAIN|ONCHAIN_VERIFIED|VERIFIED_SOURCE_AND_STATE)/.test(field.status||'')&&proof?.block&&proof.block!==context.block)
   return [key,missing('Current on-chain evidence does not match this analysis block.','SOURCE_BLOCK_MISMATCH',cfg.id)];
  return [key,field];
 }));
 const statuses=Object.values(fields).map(x=>x.dataState);
 const count=statuses.filter(s=>s==='DATA_FOUND').length;
 const holderCandidates=[];
 if(cardId==='holders'&&cfg.id==='ethereum'&&Array.isArray(raw?.holderCandidates)&&
    raw.holderCandidates.length>0&&raw.holderCandidates.length<=20&&
    fields.largestWalletPct.dataState==='DATA_FOUND'){
  const seen=new Set();
  for(const row of raw.holderCandidates){
   const address=typeof row?.address==='string'?row.address.toLowerCase():'';
   if(!ADDRESS.test(address)||seen.has(address)||row.rank!==holderCandidates.length+1||
      typeof row.sharePct!=='number'||!Number.isFinite(row.sharePct)||
      row.sharePct<0||row.sharePct>100||!/^0x[0-9a-f]+$/i.test(row.block||'')||
      (row.role!=='UNKNOWN'&&row.role!=='BURN_ADDRESS')||
      (row.role==='BURN_ADDRESS'&&require('./holder-attribution').classify({network:cfg.id,chainId:cfg.chainId,address}).role!=='BURN_ADDRESS')||
      (holderCandidates.length&&row.sharePct>holderCandidates.at(-1).sharePct)||
      holderCandidates.reduce((sum,r)=>sum+r.sharePct,0)+row.sharePct>100.000001||
      row.block!==fields.largestWalletPct.evidence?.[0]?.block){
    holderCandidates.length=0;break;
   }
   seen.add(address);holderCandidates.push({address,rank:row.rank,sharePct:row.sharePct,
    role:row.role,block:row.block});
  }
 }
 // Keep the legacy total-supply and burn-address custody observations for the
 // existing headline quick-facts strip, OUTSIDE the new four research checks.
 // They are intentionally never counted as verified burned-supply metrics.
 const auxiliarySupply=cardId==='supply'?Object.fromEntries(
  ['totalSupply','circulatingSupply','burnAddressBalance','burnAddressPct']
   .map(key=>{
    const field=validateField(source[key],cfg);
    if(context&&field.dataState==='DATA_FOUND'){
     const first=field.evidence[0]||{};
     const identity=first.address||first.contract||first.token;
     if(typeof identity==='string'&&ADDRESS.test(identity)&&identity.toLowerCase()!==context.address.toLowerCase())
      return [key,missing('Supplemental supply evidence belongs to another token.','SUPPLY_CONTEXT_TOKEN_MISMATCH',cfg.id)];
     if(/^(ON_CHAIN|ONCHAIN_VERIFIED|VERIFIED_SOURCE_AND_STATE)/.test(field.status||'')&&first.block&&first.block!==context.block)
      return [key,missing('Supplemental on-chain supply evidence is from another block.','SUPPLY_CONTEXT_BLOCK_MISMATCH',cfg.id)];
    }
    return [key,field];
   })) : null;
 // Optional issuer-sourced custody evidence may accompany Supply without
 // changing any of the four metrics. Reject everything except the exact
 // disclosed Ethereum ONDO address, source, observed wallet and analysis block.
 const disclosed=cardId==='supply'&&cfg.id==='ethereum'&&context?.address===
  '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'&&Array.isArray(raw?.supplementalEvidence)?
  raw.supplementalEvidence.filter(e=>
   e?.kind==='ISSUER_DISCLOSED_WALLET_CURRENT_CUSTODY'&&
   e.chainId===1&&e.network==='ethereum'&&e.address===context.address&&
   e.wallet==='0x677fd4ed8ae623f2f625deb2d64f2070e46ca1a1'&&
   e.block===context.block&&e.sourceUrl===
    'https://blog.ondo.foundation/ondo-foundation-group-wallet-address-disclosure/'&&
   e.method==='balanceOf(issuer-disclosed custody wallet)'&&
   /^\d+$/.test(String(e.rawBalance||''))&&
   /^\d+(?:\.\d+)?$/.test(String(e.balance||''))&&
   Number.isInteger(e.decimals)&&e.decimals>=0&&e.decimals<=36).slice(0,1):[];
 const issuerNotes=disclosed.length&&Array.isArray(raw.researchNotes)?
  raw.researchNotes.filter(x=>typeof x==='string'&&x.startsWith('Ondo Foundation disclosed a locked-token custody wallet')&&x.length<600).slice(0,1):[];
 return {...(auxiliarySupply?{context:auxiliarySupply}:{}),
  ...(holderCandidates.length?{holderCandidates}:{}),
  ...(disclosed.length?{supplementalEvidence:disclosed}:{}),
  researchNotes:[...require('./research-notes').notes(cardId,fields),...issuerNotes],
  fields,status:count===keys.length?'SOURCE_BACKED':
  count>0?'PARTIAL_EVIDENCE':
  statuses.includes('SOURCE_API_FAILED')?'SOURCE_API_FAILED':'NOT_VERIFIED',
  description:typeof raw?.description==='string'?raw.description.slice(0,250):'Only chain-matched evidence is displayed.'};
}
// A failed provider call is not the same as a source reporting no evidence.
// Use constant reasons; never expose remote URLs, addresses or exception text.
function failedCard(cardId,cfg){
 const keys=SCHEMA_KEYS.get(cardId)||[];
 return {fields:Object.fromEntries(keys.map(id=>[id,{
  ...missing('This analysis source could not be verified during the scan.','CARD_SOURCE_FAILED',cfg.id),
  dataState:'SOURCE_API_FAILED',chainId:cfg.chainId
 }]))};
}
function validateBase(base,cfg,address){
 if(!base||typeof base!=='object'||base.chainId!==cfg.chainId||
  base.network!==cfg.id||base.address?.toLowerCase()!==address||
  !/^0x[0-9a-f]+$/i.test(base.block||'')||!base.token||
  typeof base.token!=='object')throw Error('Network or contract identity mismatch');
 return base;
}
function classifyStock(raw,cfg,address){
 if(cfg.id!=='robinhood'||!raw||raw.registryMatched!==true||
  raw.chainId!==cfg.chainId||raw.address?.toLowerCase()!==address||
  raw.source!=='Robinhood official asset registry')
  return {status:'NOT_VERIFIED',type:null,source:null};
 return {status:'REGISTRY_MATCHED',type:'STOCK_TOKEN',source:raw.source,
  symbol:typeof raw.symbol==='string'?raw.symbol.slice(0,30):null,
  multiplier:typeof raw.multiplier==='string'?raw.multiplier:null};
}
function createEngine(adapters){
 if(!adapters||typeof adapters!=='object')throw Error('An adapter registry is required');
 return Object.freeze({
  async report({network='ethereum',address}={}){
   const cfg=chain(network);
   if(typeof address!=='string'||!ADDRESS.test(address))throw Error('Invalid EVM token address');
   const normalized=address.toLowerCase();
   const adapter=adapters[cfg.id];
   if(!adapter||typeof adapter.inspectToken!=='function')throw Error('Chain adapter unavailable');
   const base=validateBase(await adapter.inspectToken({cfg,address:normalized}),cfg,normalized);
   require('./progress').identity(cfg.id,base);
   const [stock,...responses]=await Promise.allSettled([
    typeof adapter.inspectStock==='function'?
     Promise.resolve().then(()=>adapter.inspectStock({cfg,address:normalized,base})):Promise.resolve(null),
    ...schema.map(card=>typeof adapter.inspectCard==='function'?
     Promise.resolve().then(()=>adapter.inspectCard({cfg,address:normalized,base,cardId:card.id}))
      .then(value=>{require('./progress').card(cfg.id,base,card.id,value);return value})
      .catch(()=>{
       const failed=failedCard(card.id,cfg);
       // Progress receives a non-sensitive source-failure status while healthy
       // cards continue; errors in the progress transport cannot abort them.
       try{require('./progress').card(cfg.id,base,card.id,failed)}catch{}
       return failed;
      }):Promise.resolve(null))
   ]);
   const cards={};
   schema.forEach((card,i)=>{
    const response=responses[i];
    cards[card.id]=formatCard(card.id,response.status==='fulfilled'?response.value:null,cfg,base);
   });
   const tokenIdentity=classifyStock(stock.status==='fulfilled'?stock.value:null,cfg,normalized);
   return {ok:true,schemaVersion:1,cardCount:schema.length,network:cfg.id,chainId:cfg.chainId,
    address:normalized,block:base.block,scannedAt:new Date().toISOString(),
    token:base.token,tokenIdentity,cards,
    warnings:['Incomplete source evidence is NOT VERIFIED.','Stock registry identity does not verify economic price, shares-per-token conversion, ownership or liquidity.']};
  },
  async discover({network='ethereum',query}={}){
   const cfg=chain(network);
   if(typeof query!=='string'||query.length>48||query.length<2)throw Error('Invalid discovery query');
   const adapter=adapters[cfg.id];
   if(!adapter||typeof adapter.discover!=='function')throw Error('Discovery adapter unavailable');
   const items=await adapter.discover({cfg,query});
   if(!Array.isArray(items))throw Error('Invalid discovery response');
   const seen=new Set(),safe=[];
   for(const item of items.slice(0,200)){
    if(item?.chainId!==cfg.chainId||item?.network!==cfg.id)continue;
    const address=typeof item.address==='string'?item.address.toLowerCase():'';
    if(!ADDRESS.test(address)||seen.has(address))continue;
    seen.add(address);
    safe.push({name:typeof item.name==='string'?item.name.slice(0,90):'',
     symbol:typeof item.symbol==='string'?item.symbol.slice(0,30):'',
     address,chainId:cfg.chainId,network:cfg.id,
     logoUrl:safeLogoUrl(item.logoUrl),
     source:typeof item.source==='string'?item.source.slice(0,100):'Unverified search catalog',
     registryMatched:cfg.id==='robinhood'&&item.registryMatched===true&&
      item.source==='Robinhood official asset registry'});
    if(safe.length===12)break;
   }
   return {chainId:cfg.chainId,network:cfg.id,candidates:safe,
    warning:'Search matches are candidates, not proof of official token identity. Confirm full contract address.'};
  }
 });
}
module.exports={createEngine,validateField,validateBase,classifyStock,formatCard,missing};
