'use strict';
// Conservative address role attribution. This module NEVER guesses the
// beneficial owner of an address from balance, ticker, or contract bytecode.
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const ROLES=new Set(['ISSUER_TREASURY','VESTING','EXCHANGE_CUSTODY','BRIDGE_CUSTODY','LIQUIDITY_POOL','BURN_ADDRESS','OTHER_VERIFIED_CONTRACT']);
const SOURCES=new Set(['ISSUER_OFFICIAL','VERIFIED_EXPLORER_CONTRACT','VERIFIED_REGISTRY']);
const NETWORKS=new Map([['arc',5042],['ethereum',1],['robinhood',4663]]);
const ZERO='0x'+'0'.repeat(40);
const DEAD='0x'+'0'.repeat(36)+'dead';
function classify({network,chainId,address,proof}={}){
 const expected=NETWORKS.get(network);
 if(!expected||chainId!==expected||typeof address!=='string'||!ADDRESS.test(address))
  return {role:'UNKNOWN',verified:false,reason:'Invalid or mismatched chain/address; attribution withheld.'};
 const normalized=address.toLowerCase();
 if(normalized===ZERO||normalized===DEAD)
  return {role:'BURN_ADDRESS',verified:true,address:normalized,chainId,scope:'Standard zero/dead custody address; NOT proof of an issuer burn event or permanent supply reduction.',evidenceType:'DETERMINISTIC_ADDRESS'};
 if(!proof||proof.chainId!==chainId||String(proof.address||'').toLowerCase()!==normalized||
    !ROLES.has(proof.role)||!SOURCES.has(proof.sourceType)||
    !proof.reviewed||typeof proof.sourceUrl!=='string')
  return {role:'UNKNOWN',verified:false,reason:'No reviewed, exact-chain, exact-address role evidence.'};
 let url;
 try{url=new URL(proof.sourceUrl);}catch{return {role:'UNKNOWN',verified:false,reason:'Evidence URL invalid.'};}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||proof.role==='BURN_ADDRESS')
  return {role:'UNKNOWN',verified:false,reason:'Evidence provenance invalid.'};
 return {role:proof.role,verified:true,address:normalized,chainId,sourceType:proof.sourceType,sourceUrl:url.href,scope:'Verified address role only; does not establish ultimate beneficial ownership.'};
}
module.exports={classify,ROLES,NETWORKS};
