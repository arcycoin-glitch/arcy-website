'use strict';
// Optional, bounded source fallback for Arc, Ethereum and Robinhood Mechanics.
// Blockscout is accepted ONLY for a fully verified contract whose published
// deployed bytecode is byte-for-byte identical to eth_getCode at the pinned block.
// An explorer ABI, partial verification or function name alone is never proof of
// tax, mint or admin semantics. No network / token ticker guesses.
const crypto=require('node:crypto');
const ADDR=/^0x[0-9a-f]{40}$/i,HEX=/^0x(?:[0-9a-f]{2})+$/i;
const HOSTS=Object.freeze({
 ethereum:'https://eth.blockscout.com',
 arc:'https://explorer.arc.io',
 robinhood:'https://robinhoodchain.blockscout.com'
});
const MAX_FILES=64,MAX_SOURCE_BYTES=3*1024*1024,MAX_ABI=400;
function validPath(value){
 if(typeof value!=='string'||!value||value.length>180||value.includes('..')||value.startsWith('/')||/[^a-zA-Z0-9_./@-]/.test(value))return false;
 return true;
}
function parse(data,{network,address,code}){
 if(!Object.hasOwn(HOSTS,network)||!ADDR.test(address||'')||!HEX.test(code||''))return null;
 if(!data||typeof data!=='object'||Array.isArray(data))return null;
 if(data.is_verified!==true||data.is_fully_verified!==true||data.is_partially_verified===true||data.is_changed_bytecode===true)return null;
 // Blockscout's verified source alone does not establish the current on-chain
 // runtime. Compare its deployed bytecode against our independent RPC read.
 if(typeof data.deployed_bytecode!=='string'||!HEX.test(data.deployed_bytecode)||
    data.deployed_bytecode.toLowerCase()!==code.toLowerCase())return null;
 const reported=data.address?.hash||data.address_hash||data.contract_address;
 if(reported&&(typeof reported!=='string'||reported.toLowerCase()!==address.toLowerCase()))return null;
 if(data.language&&String(data.language).toLowerCase()!=='solidity')return null;
 const abi=typeof data.abi==='string'?(()=>{try{return JSON.parse(data.abi)}catch{return null}})():data.abi;
 if(!Array.isArray(abi)||abi.length>MAX_ABI||!abi.every(f=>f&&typeof f.type==='string'&&(f.type!=='function'||typeof f.name==='string'&&Array.isArray(f.inputs)&&Array.isArray(f.outputs)&&[...f.inputs,...f.outputs].every(p=>typeof p?.type==='string'))))return null;
 if(typeof data.source_code!=='string'||!data.source_code.trim())return null;
 if(data.file_path&& !validPath(data.file_path))return null;
 const main=data.file_path||'VerifiedContract.sol';
 const records=[[main,data.source_code]];
 if(data.additional_sources!==undefined){
  if(!Array.isArray(data.additional_sources)||data.additional_sources.length>=MAX_FILES)return null;
  for(const e of data.additional_sources){
   if(!e||!validPath(e.file_path)||typeof e.source_code!=='string'||!e.source_code.trim())return null;
   records.push([e.file_path,e.source_code]);
  }
 }
 if(records.length>MAX_FILES||new Set(records.map(x=>x[0])).size!==records.length)return null;
 if(records.reduce((n,[p,s])=>n+Buffer.byteLength(p)+Buffer.byteLength(s),0)>MAX_SOURCE_BYTES)return null;
 const sources=Object.fromEntries(records.sort(([a],[b])=>a.localeCompare(b)).map(([p,s])=>[p,{content:s}]));
 const sourceDigest=crypto.createHash('sha256').update(JSON.stringify(Object.entries(sources).map(([p,v])=>[p,v.content]))).digest('hex');
 return {abi,sources,main,digest:sourceDigest,runtimeMatch:'match',
  sourceProvider:'Blockscout',sourceAssurance:'EXPLORER_FULL_VERIFICATION_PLUS_EXACT_ONCHAIN_BYTECODE',
  compilation:{name:data.name||null,compilerVersion:data.compiler_version||null},
  immutableReferences:{}};
}
async function retrieve({cfg,address,code,reader,diagnostics=[]}){
 const base=HOSTS[cfg?.id];
 if(!base||!ADDR.test(address||''))return null;
 const url=base+'/api/v2/smart-contracts/'+address.toLowerCase();
 try{
  const data=await reader.json(url,{timeoutMs:3500,maxBytes:4*1024*1024,validate:v=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)});
  const result=parse(data,{network:cfg.id,address,code});
  if(!result){
   diagnostics.push({source:'Blockscout',address,chainId:cfg.chainId,sourceUrl:url,reason:'SOURCE_VERIFICATION_INSUFFICIENT'});
   return null;
  }
  // Only the same conservative, independently pinned OZ source analysis as Sourcify.
  let template=null,templateDiagnostic=null;
  try{
   const oz=require('./oz-template'),opts={lib:require('./oz-library-hashes'),main:result.main};
   template=oz.analyze(result.sources,opts);
   if(!template)templateDiagnostic=oz.diagnose(result.sources,opts)?.reason||'NOT_CLASSIFIED';
  }catch{}
  return {...result,...(template?{template}:{}),templateDiagnostic,
   url,retrievedAt:new Date(reader.observedAt(url)||Date.now()).toISOString()};
 }catch(e){
  diagnostics.push({source:'Blockscout',address,chainId:cfg.chainId,sourceUrl:url,
   reason:e.httpStatus===404?'SOURCE_CODE_UNAVAILABLE':e.httpStatus===429?'SOURCE_RATE_LIMIT':e.code==='SOURCE_TIMEOUT'?'SOURCE_TIMEOUT':'SOURCE_API_FAILED'});
  return null;
 }
}
module.exports={parse,retrieve,HOSTS,validPath};
