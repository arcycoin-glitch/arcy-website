'use strict';
// Contract-exact public explorer fallback. Explorer verification is an
// attestation, not a local source recompilation or a reviewed semantics proof.
const crypto=require('node:crypto');
const EXPLORERS=Object.freeze({
 ethereum:Object.freeze({chainId:1,origin:'https://eth.blockscout.com'}),
 robinhood:Object.freeze({chainId:4663,origin:'https://robinhoodchain.blockscout.com'})
});
const ADDRESS=/^0x[0-9a-f]{40}$/i,CODE=/^0x(?:[0-9a-f]{2})+$/i;
function fail(code){throw Object.assign(Error(code),{code});}
function sourceDigest(sources){return crypto.createHash('sha256').update(JSON.stringify(Object.entries(sources).map(([p,x])=>[p,x.content]).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');}
function config(cfg){
 const fixed=EXPLORERS[cfg?.id];
 if(!fixed||cfg.chainId!==fixed.chainId)return null;
 return fixed;
}
function validAbi(abi){
 return Array.isArray(abi)&&abi.every(f=>f&&typeof f.type==='string'&&
  (f.type!=='function'||typeof f.name==='string'&&Array.isArray(f.inputs)&&Array.isArray(f.outputs)&&
   [...f.inputs,...f.outputs].every(p=>typeof p?.type==='string')));
}
function validate(body,{cfg,address,code}){
 const fixed=config(cfg);
 if(!fixed||!ADDRESS.test(address||'')||!CODE.test(code||''))fail('EXPLORER_IDENTITY_INVALID');
 if(!body||typeof body!=='object'||Array.isArray(body))fail('EXPLORER_SCHEMA_INVALID');
 // The URL is constructed from a fixed chain-specific host and the exact
 // address. Some versions also return an identity; reject any conflict.
 for(const candidate of [body.address_hash,body.address?.hash,typeof body.address==='string'?body.address:null])
  if(candidate!=null&&(!ADDRESS.test(candidate)||candidate.toLowerCase()!==address.toLowerCase()))fail('EXPLORER_IDENTITY_MISMATCH');
 if(body.chain_id!=null&&String(body.chain_id)!==String(fixed.chainId))fail('EXPLORER_IDENTITY_MISMATCH');
 if(body.is_verified!==true||body.is_changed_bytecode===true)fail('EXPLORER_SOURCE_NOT_VERIFIED');
 if(typeof body.deployed_bytecode!=='string'||body.deployed_bytecode.toLowerCase()!==code.toLowerCase())fail('EXPLORER_BYTECODE_MISMATCH');
 let abi=body.abi;
 if(typeof abi==='string'){try{abi=JSON.parse(abi);}catch{fail('EXPLORER_ABI_INVALID');}}
 if(!validAbi(abi))fail('EXPLORER_ABI_INVALID');
 if(typeof body.source_code!=='string'||!body.source_code.trim())fail('EXPLORER_SOURCE_UNAVAILABLE');
 const main=typeof body.file_path==='string'&&body.file_path?body.file_path:'contract.sol';
 const sources={[main]:{content:body.source_code}};
 if(body.additional_sources!=null){
  if(!Array.isArray(body.additional_sources))fail('EXPLORER_SCHEMA_INVALID');
  for(const file of body.additional_sources){
   if(!file||typeof file.file_path!=='string'||!file.file_path||typeof file.source_code!=='string'||Object.hasOwn(sources,file.file_path))fail('EXPLORER_SCHEMA_INVALID');
   sources[file.file_path]={content:file.source_code};
  }
 }
 return {abi,digest:sourceDigest(sources),runtimeMatch:'EXPLORER_ATTESTED_PINNED_BYTECODE',
  attestationOnly:true,source:'Blockscout',chainId:fixed.chainId,address:address.toLowerCase(),
  scope:'Explorer-attested ABI and source, with deployed bytecode independently matched to the pinned RPC read. No local recompilation or reviewed execution semantics is claimed.'};
}
async function lookup(cfg,address,code,{reader}={}){
 const fixed=config(cfg);
 if(!fixed)return null;
 if(!ADDRESS.test(address||'')||!CODE.test(code||''))fail('EXPLORER_IDENTITY_INVALID');
 const url=fixed.origin+'/api/v2/smart-contracts/'+address.toLowerCase();
 const body=await reader.json(url,{maxBytes:4*1024*1024,timeoutMs:4000,validate:d=>{validate(d,{cfg,address,code});return true;}});
 const observed=reader.observedAt?.(url);
 return {...validate(body,{cfg,address,code}),url,retrievedAt:new Date(Number.isFinite(observed)?observed:Date.now()).toISOString()};
}
module.exports={EXPLORERS,config,validate,lookup,sourceDigest};
