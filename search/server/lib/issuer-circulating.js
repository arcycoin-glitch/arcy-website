'use strict';
// Issuer-published chain accounting, not inferred treasury or burn exclusions.
const {unknown,found}=require('./evidence');
const {createReader}=require('./source-request');
const reader=createReader({ttlMs:60000,maxEntries:2});
const TOKEN='0xdac17f958d2ee523a2206206994597c13d831ec7';
const URL='https://app.tether.to/transparency.json';
const IDENTITY='https://tether.to/en/supported-protocols/';
const DAY=86400000;
function raw(value){
 if(value===0)return 0n;
 if(typeof value!=='string'||value.length>100||!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value))throw Error('ISSUER_AMOUNT_INVALID');
 const [whole,fraction='']=value.split('.');return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
}
function parse(body,{address,totalSupply,now=Date.now(),block,network='ethereum',chainId=1}={}){
 if(network!=='ethereum'||chainId!==1||typeof address!=='string'||address.toLowerCase()!==TOKEN||!/^0x[0-9a-f]+$/i.test(block||''))return unknown('No reviewed issuer circulation mapping for this pinned Ethereum contract.','NO_ISSUER_CIRCULATION_MAPPING');
 const fail=reason=>unknown(reason,'ISSUER_CIRCULATION_NOT_RECONCILED');
 try{
  const currencies=body?.data_formatted?.filter(x=>x.iso==='usdt');
  if(currencies?.length!==1||body.data?.usdt?.currency_iso!=='usdt')return fail('Issuer currency identity is missing or ambiguous.');
  const currency=currencies[0],rows=currency.blockChains?.filter(x=>x.name==='Ethereum');
  if(rows?.length!==1)return fail('Issuer Ethereum accounting is missing or ambiguous.');
  const updated=currency.id*1000;
  if(!Number.isInteger(currency.id)||!Number.isFinite(now)||updated>now+60000||now-updated>3*DAY)return fail('Issuer publication is stale or future-dated.');
  const row=rows[0],authorized=raw(row.totalAuthorized),notIssued=raw(row.notIssued),quarantined=raw(row.quarantined),data=body.data.usdt;
  if(authorized!==raw(data.totaltokens_eth)||notIssued!==raw(data.reserve_balance_eth)||quarantined!==raw(data.quarantined_eth))return fail('Issuer raw and formatted Ethereum accounting disagree.');
  if(authorized<=0n||authorized!==raw(totalSupply)||notIssued+quarantined>=authorized)return fail('Issuer authorized supply does not reconcile to pinned Ethereum totalSupply, or exclusions are invalid.');
  const value=require('./eth').units(authorized-notIssued-quarantined,6);
  const asOf=new Date(updated).toISOString();
  const field=found(value,'Tether issuer Ethereum transparency accounting',[{address:TOKEN,chainId:1,network:'ethereum',block,
   sourceUrl:URL,identitySourceUrl:IDENTITY,methodologySourceUrl:'https://usdt.network/methodology',sourceAsOf:asOf,
   method:'Issuer net circulation = Ethereum authorized - authorized but not issued - quarantined; authorized supply reconciled to pinned totalSupply()',
   authorizedRaw:authorized.toString(),notIssuedRaw:notIssued.toString(),quarantinedRaw:quarantined.toString(),decimals:6,
   scope:'Issuer-reported Ethereum-only circulation at the stated publication time; reserve/quarantine classifications are issuer assertions, not an independently enumerated wallet ledger. RPC validates authorized supply, not every exclusion. Not current-block on-chain circulating supply.'}],'SOURCE_REPORTED');
  field.freshness={state:now-updated>DAY?'LAST_VERIFIED':'SOURCE_REPORTED',observedAt:asOf,sourceAsOf:asOf,retrievedAt:new Date(now).toISOString(),ageMs:Math.max(0,now-updated),basis:'Issuer publication timestamp, not browser retrieval time.'};
  return field;
 }catch{return fail('Issuer response has malformed or unsupported exact-decimal accounting.');}
}
async function inspect(address,totalSupply,options={}){
 if(typeof address!=='string'||address.toLowerCase()!==TOKEN)return null;
 if(options.network!==undefined&&options.network!=='ethereum'||options.chainId!==undefined&&options.chainId!==1)return unknown('Issuer data is Ethereum-specific, not cross-chain circulation.','SOURCE_CHAIN_MISMATCH');
 // Research access is not a commercial redistribution license. Operators
 // must verify applicable written rights before enabling public display.
 if((options.env||process.env).TETHER_TRANSPARENCY_DISPLAY_APPROVED!=='1')return unknown(
  'Official issuer circulation integration is prepared but public-display permission has not been verified.',
  'ISSUER_CIRCULATION_PERMISSION_REQUIRED');
 try{const body=await reader.json(URL,{timeoutMs:2500,maxBytes:128*1024,fetcher:options.fetcher||global.fetch,
  validate:d=>Array.isArray(d?.data_formatted)&&typeof d?.data?.usdt==='object'});return parse(body,{address,totalSupply,...options});}
 catch{return {...unknown('Official issuer transparency request failed; no circulation value was inferred.','ISSUER_CIRCULATION_SOURCE_FAILED'),dataState:'SOURCE_API_FAILED',source:'Tether official transparency'};}
}
module.exports={parse,inspect,raw,TOKEN,URL};
