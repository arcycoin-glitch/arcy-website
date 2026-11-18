'use strict';
// Decorative token artwork is identified only by network + exact contract. Never resolve by ticker/name.
// Keep candidate-level images when Radar V3 exports near-miss/excluded evidence to Radar V4.
// Untrusted/missing art stays null; this is NOT issuer or security verification.
const {logoUrl}=require('./gecko');
const {localLogo}=require('../../search/server/lib/search-logo');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const PROVIDERS=new Set(['GeckoTerminal','DEX Screener','ARCY Search exact-contract artwork']);
function candidateArtwork(row){
 if(!row||!ADDRESS.test(String(row.address||'')))return null;
 const raw=typeof row.logo==='string'?row.logo:row.logo?.url;
 const provider=typeof row.logo==='object'?row.logo?.source:'GeckoTerminal';
 if(!PROVIDERS.has(provider))return null; // do not fabricate source attribution
 const approved=logoUrl(raw);
 if(approved)return {url:approved,source:provider};
 const local=localLogo(row.network,row.address);
 if(local&&raw===local)return {url:local,source:'ARCY Search exact-contract artwork'};
 return null;
}
function removeSharedArtwork(rows){
 // A third-party image shared by different exact contracts must not establish false identity.
 const owners=new Map();
 for(const row of rows){
  const url=row.logo?.url;
  if(!url||url.startsWith('/'))continue;
  if(!owners.has(url))owners.set(url,new Set());
  owners.get(url).add(row.chainId+':'+String(row.address).toLowerCase());
 }
 return rows.map(row=>row.logo?.url&&!row.logo.url.startsWith('/')&&owners.get(row.logo.url)?.size>1?
  {...row,logo:null}:row);
}
module.exports={candidateArtwork,removeSharedArtwork};
