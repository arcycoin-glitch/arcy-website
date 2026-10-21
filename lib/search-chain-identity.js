'use strict';
// Shared, read-only chain identity helpers for the ARCY SEARCH migration.
// Existing Arc-only routes remain unchanged until their adapters are migrated.
const CHAINS=Object.freeze({
  5042:Object.freeze({id:5042,key:'arc',label:'Arc'}),
  1:Object.freeze({id:1,key:'ethereum',label:'Ethereum'}),
  4663:Object.freeze({id:4663,key:'robinhood',label:'Robinhood Chain'})
});
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
function chain(input){
  if(typeof input!=='string'&&typeof input!=='number')return null;
  const value=String(input).trim();
  if(!/^(0|[1-9][0-9]*)$/.test(value))return null;
  return CHAINS[Number(value)]||null;
}
function identity(chainId,address){
  const network=chain(chainId);
  if(!network||typeof address!=='string'||!ADDRESS.test(address))return null;
  return Object.freeze({chainId:network.id,chain:network.key,address:address.toLowerCase(),key:`holders:v3:${network.id}:${address.toLowerCase()}`});
}
function verifiedField(value,source,evidence,observedAt){
  if(value===null||value===undefined||!source||!Array.isArray(evidence)||!evidence.length||!Number.isFinite(Date.parse(observedAt||'')))
    return Object.freeze({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',source:null,evidence:[]});
  return Object.freeze({value,status:'ONCHAIN_VERIFIED',dataState:'DATA_FOUND',source,evidence,observedAt});
}
module.exports={CHAINS,chain,identity,verifiedField};
