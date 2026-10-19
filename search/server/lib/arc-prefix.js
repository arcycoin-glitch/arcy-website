'use strict';
// Optional Arcscan public directory lookup for short token-name prefixes.
// Directory entries are CANDIDATES; never official issuer identity or holders.
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const {readJson}=require('./http');
function parse(payload,query){
 const records=Array.isArray(payload)?payload:
  [payload?.suggestions,payload?.items,payload?.results,payload?.data?.suggestions,payload?.data?.items].find(Array.isArray)||[];
 const needle=query.normalize('NFKC').toLowerCase();
 const seen=new Set(),out=[];
 for(const item of records.slice(0,50)){
  if(!item||typeof item!=='object')continue;
  const raw=item.address||item.contract_address||item.contractAddress||item.address_hash||item.token?.address;
  const name=item.name||item.token?.name||item.label;
  const symbol=item.symbol||item.token?.symbol||'';
  if(typeof raw!=='string'||!ADDRESS.test(raw)||typeof name!=='string'||!name.trim())continue;
  const chain=item.chainId??item.chain_id??item.networkId;
  if(chain!==undefined&&Number(chain)!==5042)continue;
  if(![name,symbol].some(v=>typeof v==='string'&&v.toLowerCase().startsWith(needle)))continue;
  const address=raw.toLowerCase();
  if(seen.has(address))continue;
  seen.add(address);
  out.push({network:'arc',chainId:5042,address,name:name.slice(0,90),
   symbol:String(symbol).slice(0,30),source:'Arcscan public token search (unverified identity)',
   registryMatched:false,identityVerified:false});
  if(out.length===12)break;
 }
 return out;
}
async function discover(query,{fetcher=fetch}={}){
 if(typeof query!=='string'||query.length<2||query.length>48)return [];
 const url='https://api.arc-scan.org/v1/search/suggest?q='+encodeURIComponent(query)+'&limit=20';
 const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(1800)});
 if(!response.ok)return [];
 const body=await readJson(response,256*1024);
 return parse(body,query);
}
module.exports={parse,discover};
