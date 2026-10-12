'use strict';
const f=require('./fields');
async function validate(address,value,source,evidence,totalHint){
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)
  return {...f.field(null,'NOT_VERIFIED',source,evidence,'NONE'),dataState:'SOURCE_HAS_NO_DATA',reasonCode:'NO_POSITIVE_CIRCULATING_SUPPLY'};
 if(typeof totalHint==='number'&&Number.isFinite(totalHint)&&totalHint>0&&value>totalHint)
  return {...f.field(null,'NOT_VERIFIED',source,evidence,'NONE'),reasonCode:'CIRCULATING_EXCEEDS_SOURCE_SUPPLY'};
 const supply=await require('../api/supply')({query:{address}},{setHeader(){},status(){return this},json(x){return x}});
 if(!supply.ok)return {...f.field(null,'NOT_VERIFIED',source,evidence,'NONE'),dataState:'SOURCE_API_FAILED',reasonCode:'SUPPLY_CROSS_CHECK_FAILED'};
 if(value>Number(supply.totalSupply.amount))return {...f.field(null,'NOT_VERIFIED',source,evidence,'NONE'),reasonCode:'CIRCULATING_EXCEEDS_ONCHAIN_SUPPLY'};
 return f.field(value,'MARKET_API_VERIFIED',source,evidence.concat({method:'Exact chain/contract and pinned on-chain totalSupply cross-check',block:supply.block,totalSupply:supply.totalSupply.amount}));
}
async function gecko(address){
 const url='https://api.geckoterminal.com/api/v2/networks/arc/tokens/'+address;
 const result=await require('./market-activity').gecko(address);
 if(result?.attributes?.address?.toLowerCase()!==address.toLowerCase())
  return {value:null,status:'NOT_VERIFIED',reasonCode:'MARKET_CONTRACT_IDENTITY_MISMATCH'};
 return {value:null,status:'NOT_VERIFIED',source:'GeckoTerminal',dataState:'SOURCE_HAS_NO_DATA',
  reasonCode:'GECKOTERMINAL_NO_CIRCULATING_FIELD',
  reason:'Circulating supply is not provided as a verifiable field; FDV, market cap, or total supply do not establish circulation.',
  evidence:[{url,contractMatched:true,availableFields:Object.keys(result.attributes)}]};
}
async function metadata(address){
 const result=await require('./project-metadata').read(address);
 if(!result.value)return result;
 const value=await validate(address,result.value.circulatingSupply,result.source,result.evidence,result.value.totalSupply);
 if(value.value!==null){value.status='OFFICIAL_DOCUMENTATION';value.confidence='PROJECT_REPORTED';}
 return value;
}
async function linkedCoin(){
 return {value:null,status:'NOT_VERIFIED',dataState:'SOURCE_HAS_NO_DATA',
  reasonCode:'PROVIDER_DISABLED_LICENSE_UNVERIFIED',
  reason:'CoinGecko API is disabled until applicable commercial-use rights are verified.'};
}
module.exports={validate,gecko,metadata,linkedCoin};
