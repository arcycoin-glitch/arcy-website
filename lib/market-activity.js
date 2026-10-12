'use strict';
const c=require('./core'),f=require('./fields');
const finite=(value,positive=false)=>value!==null&&value!==undefined&&
 ['number','string'].includes(typeof value)&&!(typeof value==='string'&&!value.trim())&&
 Number.isFinite(Number(value))&&(!positive||Number(value)>0)?Number(value):null;
async function dexPairs(){
 throw Object.assign(Error('DEX Screener API disabled pending commercial-use verification.'),
  {code:'PROVIDER_DISABLED_LICENSE_UNVERIFIED'});
}
async function gecko(address){
 const url='https://api.geckoterminal.com/api/v2/networks/arc/tokens/'+address+'?include=top_pools';
 const data=await f.cached('gecko-activity:'+address,60000,()=>c.json(url));
 if(data.data?.id!=='arc_'+address||String(data.data?.attributes?.address).toLowerCase()!==address)
  throw Object.assign(Error('Market contract identity mismatch'),{code:'MARKET_CONTRACT_IDENTITY_MISMATCH'});
 const attrs=data.data.attributes;
 const pool=data.included?.filter(item=>item.type==='pool'&&
  item.relationships?.base_token?.data?.id==='arc_'+address)
  .sort((a,b)=>(finite(b.attributes?.reserve_in_usd)||0)-(finite(a.attributes?.reserve_in_usd)||0))[0];
 const evidence=[{url,chainId:5042,address,pool:pool?.id,
  scope:'Contract-address resolved GeckoTerminal token and exact matching base-token pool.'}];
 const field=value=>f.field(value,'MARKET_API_VERIFIED','GeckoTerminal',evidence);
 const fdv=finite(attrs.fdv_usd,true);
 return {priceUsd:field(finite(attrs.price_usd,true)),
  valuation:{...field(fdv),kind:fdv!==null?'FDV':null},
  change24h:field(finite(pool?.attributes?.price_change_percentage?.h24)),
  volume24h:field(finite(attrs.volume_usd?.h24)),
  attributes:attrs};
}
async function read(address){
 let fields={priceUsd:c.unknown(),valuation:c.unknown(),change24h:c.unknown(),volume24h:c.unknown()},attempts=[];
 try{
  const values=await gecko(address);
  attempts.push({source:'GeckoTerminal',dataState:'DATA_FOUND'});
  for(const key of Object.keys(fields))if(values[key]?.value!==null&&values[key]?.value!==undefined)fields[key]=values[key];
 }catch(error){attempts.push({source:'GeckoTerminal',...c.failure(error)});}
 for(const key of Object.keys(fields))if(fields[key].value===null)fields[key]={...fields[key],
  dataState:attempts.some(item=>item.dataState==='SOURCE_API_FAILED')?'SOURCE_API_FAILED':'SOURCE_HAS_NO_DATA',
  reasonCode:attempts.some(item=>item.dataState==='SOURCE_API_FAILED')?'MARKET_API_FAILED':'NO_CONTRACT_MATCHED_MARKET_VALUE',
  reason:'GeckoTerminal did not return this field for the exact Arc contract.',attempts};
 return {fields,...fields,dataState:Object.values(fields).some(item=>item.value!==null)?'DATA_FOUND':
  attempts.every(item=>item.dataState==='SOURCE_API_FAILED')?'SOURCE_API_FAILED':'SOURCE_HAS_NO_DATA',
  attempts,methodology:'Exact Arc contract identity; GeckoTerminal source-reported values only. FDV is separate from market cap; unsupported circulation remains NOT VERIFIED.'};
}
module.exports={read,gecko,dexPairs,finite};
