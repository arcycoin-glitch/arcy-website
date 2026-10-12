'use strict';
/**
 * GoPlus exact-network ERC-20 risk observations.
 * GoPlus describes its token security API as open and license-free.
 * These are detection/simulation observations, never a substitute for
 * on-chain source review or proof that privileged roles do not exist.
 * https://www.gopluslabs.io/en/security-api
 */
const {readJson}=require('./http');
const {chain}=require('./chains');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const NETWORKS=Object.freeze({ethereum:1,robinhood:4663});
const ORIGIN='https://api.gopluslabs.io/api/v1/token_security/';
const TTL=120000;
const cache=new Map(),inflight=new Map();
function missing(reason,code='SECURITY_SOURCE_UNAVAILABLE'){
 return {value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',reason,reasonCode:code,source:null,evidence:[]};
}
const bool=v=>v==='1'?true:v==='0'?false:null;
function fraction(v){
 if((typeof v!=='string'&&typeof v!=='number')||v==='')return null;
 const n=Number(v);
 return Number.isFinite(n)&&n>=0&&n<=1?Math.round(n*1e6)/10000:null;
}
function found(value,network,address,method,scope,now){
 return {value,source:'GoPlus Security',status:'SOURCE_REPORTED',dataState:'DATA_FOUND',
  chainId:chain(network).chainId,network,
  evidence:[{provider:'GoPlus Security',chainId:chain(network).chainId,network,address,
   sourceUrl:ORIGIN+NETWORKS[network]+'?contract_addresses='+address,
   checkedAt:new Date(now).toISOString(),method,scope}]};
}
function parse(body,network,rawAddress,{now=Date.now()}={}){
 if(!Object.hasOwn(NETWORKS,network)||typeof rawAddress!=='string'||!ADDRESS.test(rawAddress))
  throw Error('Invalid security source identity');
 const address=rawAddress.toLowerCase();
 const fields={
  tradingTaxes:missing('GoPlus did not report both buy and sell tax simulations.'),
  mintCapability:missing('No attributable mint-capability detection.'),
  ownerAdmin:missing('No attributable owner or admin address.'),
  contractArchitecture:missing('Proxy/architecture status was not established.')
 };
 if(!body||(body.code!==1&&body.code!=='1')||!body.result||
    typeof body.result!=='object'||Array.isArray(body.result))return fields;
 const record=Object.entries(body.result).find(([key])=>key.toLowerCase()===address)?.[1];
 if(!record||typeof record!=='object'||Array.isArray(record))return fields;
 const buy=fraction(record.buy_tax),sell=fraction(record.sell_tax),transfer=fraction(record.transfer_tax);
 const scope='GoPlus source-reported simulation/detection only. Actual fees, proxy powers, undiscovered roles and transfer behavior may differ.';
 if(buy!==null&&sell!==null){
  const value='Buy '+buy+'% · Sell '+sell+'%'+
    (transfer!==null?' · Transfer '+transfer+'%':' · Transfer not reported');
  fields.tradingTaxes=found(value,network,address,'buy_tax/sell_tax'+
   (transfer!==null?'/transfer_tax':''),scope,now);
 }
 const mint=bool(record.is_mintable);
 if(mint!==null)fields.mintCapability=found(mint?
  'GoPlus reports mint capability':'No mint function detected by GoPlus',
  network,address,'is_mintable',scope,now);
 const owner=typeof record.owner_address==='string'?record.owner_address.toLowerCase():'';
 if(ADDRESS.test(owner))fields.ownerAdmin=found(owner==='0x'+'0'.repeat(40)?
  'GoPlus reports zero owner address; other roles unverified':
  'GoPlus-reported owner: '+owner,network,address,'owner_address',scope,now);
 const proxy=bool(record.is_proxy);
 if(proxy!==null)fields.contractArchitecture=found(proxy?
  'GoPlus reports proxy contract; upgrade authority unverified':
  'No proxy detected by GoPlus; other upgrade designs remain possible',
  network,address,'is_proxy',scope,now);
 return fields;
}
async function json(url,{fetcher=global.fetch,now=Date.now()}={}){
 const hit=cache.get(url);
 if(fetcher===global.fetch&&hit&&hit.expires>now)return structuredClone(hit.body);
 if(fetcher===global.fetch&&inflight.has(url))return structuredClone(await inflight.get(url));
 const task=(async()=>{
  const res=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8500)});
  if(!res?.ok)throw Error('GoPlus HTTP '+String(res?.status||'UNKNOWN'));
  const body=await readJson(res,1024*1024);
  if(fetcher===global.fetch){cache.set(url,{body,expires:Date.now()+TTL});if(cache.size>120)cache.delete(cache.keys().next().value)}
  return body;
 })();
 if(fetcher!==global.fetch)return task;
 inflight.set(url,task);
 try{return structuredClone(await task)}finally{if(inflight.get(url)===task)inflight.delete(url)}
}
async function inspect(network,address,{fetcher=global.fetch,now=Date.now()}={}){
 if(!Object.hasOwn(NETWORKS,network)||typeof address!=='string'||!ADDRESS.test(address))
  throw Error('Invalid security network or address');
 const token=address.toLowerCase();
 const url=ORIGIN+NETWORKS[network]+'?contract_addresses='+encodeURIComponent(token);
 try{return parse(await json(url,{fetcher,now}),network,token,{now})}
 catch{return parse(null,network,token,{now})}
}
function parseHolders(body,network,rawAddress,{now=Date.now()}={}){
 if(!Object.hasOwn(NETWORKS,network)||typeof rawAddress!=='string'||!ADDRESS.test(rawAddress))
  throw Error('Invalid holder source identity');
 const address=rawAddress.toLowerCase();
 const fields={
  holderCount:missing('No exact-contract GoPlus holder count was supplied.','HOLDER_COUNT_UNVERIFIED'),
  largestWalletPct:missing('No complete source-ranked large holder list.','HOLDER_RANK_NOT_VERIFIED'),
  top10Pct:missing('Ten distinct source-ranked wallet shares are unavailable.','TOP10_NOT_VERIFIED'),
  top20Pct:missing('GoPlus provides only a limited top-holder list; not a validated top 20.','TOP20_NOT_VERIFIED')
 };
 if(!body||(body.code!==1&&body.code!=='1')||!body.result||
    typeof body.result!=='object'||Array.isArray(body.result))return fields;
 const record=Object.entries(body.result).find(([key])=>key.toLowerCase()===address)?.[1];
 if(!record||typeof record!=='object'||Array.isArray(record))return fields;
 const rawCount=record.holder_count;
 const count=(typeof rawCount==='string'&&/^[1-9]\\d*$/.test(rawCount))?Number(rawCount):
  typeof rawCount==='number'?rawCount:null;
 const validCount=Number.isSafeInteger(count)&&count>0&&count<1e10;
 const scope='GoPlus-reported token holder population and limited ranked wallet snapshot, not independently pinned or fully enumerated. Exchange custody and multiple wallets per owner are not resolved; source publication timestamp may differ from retrieval time.';
 if(validCount)fields.holderCount=found(count,network,address,'holder_count',scope,now);
 if(!validCount||!Array.isArray(record.holders)||record.holders.length<1)return fields;
 const seen=new Set(),shares=[];
 for(const row of record.holders.slice(0,10)){
  const wallet=typeof row?.address==='string'?row.address.toLowerCase():'';
  const raw=typeof row?.percent==='string'?row.percent:null;
  if(!ADDRESS.test(wallet)||seen.has(wallet)||raw===null||
    !/^(?:0|1)(?:\\.\\d{1,30})?$/.test(raw))return fields;
  const fractionNumber=Number(raw);
  if(!Number.isFinite(fractionNumber)||fractionNumber<=0||fractionNumber>1)return fields;
  seen.add(wallet);shares.push(fractionNumber);
 }
 if(shares.length>count||shares.some((v,i)=>i>0&&shares[i-1]+1e-10<v)||
    shares.reduce((a,b)=>a+b,0)>1.00001)return fields;
 const percent=v=>Math.round(v*1000000)/10000;
 fields.largestWalletPct=found(percent(shares[0]),network,address,'largest GoPlus holder percent',scope,now);
 if(shares.length===10)fields.top10Pct=found(
  percent(shares.reduce((a,b)=>a+b,0)),network,address,
  'sum of ten GoPlus source-ranked holder percentages',scope,now);
 return fields;
}
async function inspectHolders(network,address,{fetcher=global.fetch,now=Date.now()}={}){
 if(!Object.hasOwn(NETWORKS,network)||typeof address!=='string'||!ADDRESS.test(address))
  throw Error('Invalid holder network or address');
 const token=address.toLowerCase();
 try{
  const url=ORIGIN+NETWORKS[network]+'?contract_addresses='+encodeURIComponent(token);
  return parseHolders(await json(url,{fetcher,now}),network,token,{now});
 }catch{return parseHolders(null,network,token,{now})}
}
module.exports={NETWORKS,bool,fraction,parse,inspect,parseHolders,inspectHolders};
