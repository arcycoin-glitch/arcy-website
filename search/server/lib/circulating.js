'use strict';
const {found,unknown,error}=require('./evidence');
const {ADDRESS}=require('./eth');
const {readJson}=require('./http');
const BASE='https://api.coingecko.com/api/v3/coins/ethereum/contract/';
const MAX_AGE_MS=10*60*1000;
const cache=new Map();
const same=(a,b)=>typeof a==='string'&&a.toLowerCase()===b;
function parse(body,address,onchainSupply,observedAt=Date.now()){
 const no=(message,code)=>unknown(message,code);
 if(!body||typeof body!=='object'||Array.isArray(body))return no('CoinGecko returned invalid data.','MALFORMED_SOURCE_DATA');
 const contract=same(body.contract_address,address)||same(body.detail_platforms?.ethereum?.contract_address,address);
 const chain=body.asset_platform_id==='ethereum'||same(body.detail_platforms?.ethereum?.contract_address,address);
 if(!contract||!chain)return no('CoinGecko response does not confirm this Ethereum contract address.','CONTRACT_IDENTITY_MISMATCH');
 const value=body.market_data?.circulating_supply;
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return no('CoinGecko did not report a positive circulating supply.','CIRCULATING_SUPPLY_UNAVAILABLE');
 const supply=Number(onchainSupply);
 if(!Number.isFinite(supply)||supply<=0||value>supply)return no('Circulating supply exceeds or cannot be reconciled with the pinned on-chain total supply.','SUPPLY_RECONCILIATION_FAILED');
 return found(value,'CoinGecko',[{
   provider:'CoinGecko',assetPlatform:'ethereum',contractAddress:address,
   coinId:typeof body.id==='string'?body.id:null,
   comparison:'Contract identity matched; positive source-reported circulating <= pinned on-chain total supply.',
   scope:'Provider-reported circulating supply, not an on-chain verified wallet-by-wallet circulation calculation.'
 }],'SOURCE_REPORTED',observedAt);
}
async function inspect(address,onchainSupply){
 if(!ADDRESS.test(address))return unknown('Invalid Ethereum contract address.','INVALID_ADDRESS');
 const key=address.toLowerCase(),entry=cache.get(key);
 if(entry&&Date.now()-entry.at<MAX_AGE_MS)return parse(entry.body,key,onchainSupply,entry.at);
 try{
  const response=await fetch(BASE+key+'?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false',{
   headers:{accept:'application/json'},signal:AbortSignal.timeout(9000)
  });
  if(response.status===404)return unknown('No contract-matched CoinGecko listing for this Ethereum token.','SOURCE_HAS_NO_DATA');
  if(!response.ok)throw Error('CoinGecko upstream HTTP '+response.status);
  const body=await readJson(response,1024*1024);
  const retrievedAt=Date.now();
  const result=parse(body,key,onchainSupply,retrievedAt);
  // Cache only parsed and validated identity responses; do not cache provider errors.
  if(result.dataState==='DATA_FOUND')cache.set(key,{body,at:retrievedAt});
  return result;
 }catch(e){return error(e,'CoinGecko')}
}
module.exports={parse,inspect};
