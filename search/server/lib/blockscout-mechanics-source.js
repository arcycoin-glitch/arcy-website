'use strict';
// Optional additional contract-source evidence via Blockscout PRO, never an
// assumption that the explorer's "verified" label alone proves today's code.
// Published source is accepted ONLY when its deployed bytecode equals the
// actual bytecode read by the token report at its pinned block.
const crypto=require('node:crypto');
const ADDRESS=/^0x[0-9a-f]{40}$/i,CODE=/^0x(?:[0-9a-f]{2})+$/i;
const API_KEY=/^proapi_[A-Za-z0-9_-]{8,120}$/;
const CHAIN_IDS=Object.freeze({arc:5042,ethereum:1,robinhood:4663});
function safeSourceUrl(network,address){
 const chainId=CHAIN_IDS[network];
 if(!chainId||!ADDRESS.test(address||''))return null;
 return 'https://api.blockscout.com/'+chainId+'/api/v2/smart-contracts/'+address.toLowerCase();
}
function parseVerified({network,address,code,body,sourceUrl,observedAt}){
 const chainId=CHAIN_IDS[network],token=String(address||'').toLowerCase();
 if(!chainId||!ADDRESS.test(token)||!CODE.test(code||'')||!body||
    typeof body!=='object'||Array.isArray(body))return null;
 // A "verified twin" may refer to a different deployed contract; never
 // allow twin source or partially matched runtime to supply token authority.
 if(body.is_verified!==true||body.is_fully_verified!==true||
    body.is_partially_verified===true||body.is_changed_bytecode===true)return null;
 const returnedChain=body.chain_id??body.chainId;
 if(returnedChain!==undefined&&String(returnedChain)!==String(chainId))return null;
 const returnedAddress=body.address_hash??body.address?.hash??body.address;
 if(returnedAddress!==undefined&&String(returnedAddress).toLowerCase()!==token)return null;
 const twin=body.verified_twin_address_hash;
 if(twin&&String(twin).toLowerCase()!==token)return null;
 if(typeof body.deployed_bytecode!=='string'||!CODE.test(body.deployed_bytecode)||
    body.deployed_bytecode.toLowerCase()!==code.toLowerCase())return null;
 let abi=body.abi;
 if(typeof abi==='string'){try{abi=JSON.parse(abi)}catch{return null}}
 if(!Array.isArray(abi)||abi.length>600||!abi.every(f=>
   f&&typeof f==='object'&&!Array.isArray(f)&&typeof f.type==='string'&&
   (f.type!=='function'||typeof f.name==='string'&&Array.isArray(f.inputs)&&
    Array.isArray(f.outputs)&&[...f.inputs,...f.outputs].every(p=>typeof p?.type==='string'))))return null;
 if(typeof body.source_code!=='string'||!body.source_code.trim())return null;
 const sources=Object.create(null);
 const main=typeof body.file_path==='string'&&body.file_path.length<150&&body.file_path?
   body.file_path:'verified.sol';
 sources[main]={content:body.source_code};
 if(body.additional_sources!==undefined){
  if(!Array.isArray(body.additional_sources)||body.additional_sources.length>128)return null;
  for(const src of body.additional_sources){
   if(typeof src?.file_path!=='string'||src.file_path.length>150||!src.file_path||
      typeof src.source_code!=='string'||src.source_code.length>1000000||
      Object.hasOwn(sources,src.file_path))return null;
   sources[src.file_path]={content:src.source_code};
  }
 }
 const entries=Object.entries(sources).map(([p,x])=>[p,x.content]).sort(([a],[b])=>a.localeCompare(b));
 const digest=crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
 return {abi,digest,runtimeMatch:'exact_match',url:sourceUrl,
  retrievedAt:observedAt,verificationProvider:'Blockscout PRO',
  sourceVerification:'COMPLETE_SOURCE_AND_EXACT_PINNED_DEPLOYED_BYTECODE'};
}
async function load({network,address,code,key=process.env.BLOCKSCOUT_API_KEY,reader,now=Date.now()}={}){
 const clean=safeSourceUrl(network,address);
 if(!clean||!CODE.test(code||'')||typeof key!=='string'||!API_KEY.test(key)||
    typeof reader?.json!=='function')return null;
 // Auth credential is attached only to a server-side outbound request.
 // It is never part of the sanitized URL, cache key or returned evidence.
 const fetcher=(url,opts)=>global.fetch(url+'?apikey='+encodeURIComponent(key),opts);
 const body=await reader.json(clean,{fetcher,maxBytes:4*1024*1024,timeoutMs:4200});
 return parseVerified({network,address,code,body,sourceUrl:clean,observedAt:new Date(now).toISOString()});
}
module.exports={CHAIN_IDS,API_KEY,safeSourceUrl,parseVerified,load};
