'use strict';
const SEARCH=/^[\p{L}\p{N}\s.$_+\-&]{2,48}$/u;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const {chain}=require('./chains');
const source=require('./source-request').createReader({ttlMs:60000});
function normalizeQuery(raw){
 if(typeof raw!=='string')return null;
 const q=raw.normalize('NFKC').trim().replace(/\s+/g,' ');
 return SEARCH.test(q)&&!ADDRESS.test(q)?q:null;
}
async function discover(rawQuery){
 const q=normalizeQuery(rawQuery);
 if(!q)throw Error('Invalid discovery query');
 return searchExplorer('ethereum',q);
}
async function searchExplorer(network,rawQuery,{fetchImpl=global.fetch}={}){
 const query=normalizeQuery(rawQuery);
 if(!query)throw Error('Invalid discovery query');
 const cfg=chain(network);
 const base=new URL(cfg.explorer);
 const endpoint=new URL('/api/v2/search',base);
 endpoint.searchParams.set('q',query);
 const body=await source.json(endpoint.href,{fetcher:fetchImpl,validate:value=>Boolean(value&&Array.isArray(value.items))});
 if(!body||!Array.isArray(body.items))throw Error('Explorer search response invalid');
 const normalized=query.normalize('NFKC').toLocaleLowerCase('en-US');
 const matches=[];
 for(const item of body.items){
  if(!item||item.type!=='token')continue;
  const rawAddress=typeof item.address_hash==='string'?item.address_hash:item.address;
  if(typeof rawAddress!=='string'||!ADDRESS.test(rawAddress))continue;
  const tokenType=String(item.token_type||'').toUpperCase();
  if(network==='robinhood'?!['ERC-20','ERC-8056'].includes(tokenType):tokenType!=='ERC-20')continue;
  const address=rawAddress.toLowerCase();
  const name=typeof item.name==='string'?item.name.trim().slice(0,90):'';
  const symbol=typeof item.symbol==='string'?item.symbol.trim().slice(0,30):'';
  if(!name&&!symbol)continue;
  const haystack=(name+' '+symbol).normalize('NFKC').toLocaleLowerCase('en-US');
  if(!haystack.includes(normalized))continue;
  matches.push({address,network,chainId:cfg.chainId,name:name||symbol,symbol,
   source:'Blockscout explorer index',sourceUrl:new URL('/token/'+address,base).toString(),
   identityVerified:false,registryMatched:false,logoUrl:null});
 }
 return matches;
}
module.exports={normalizeQuery,parse:()=>[],discover,searchExplorer};
