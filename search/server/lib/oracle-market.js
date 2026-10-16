'use strict';
// Read-only Chainlink fallback for exact canonical Ethereum contracts. No
// aggregator HTTP API, DEX dataset, logo, FDV, or circulating supply is used.
const {rpc,uint}=require('./eth');
const NETWORK='ethereum',CHAIN_ID=1;
const ASSETS=Object.freeze({
 // Direct Ethereum Chainlink USD feeds; exact canonical token addresses only.
 // Sources: https://data.chain.link/feeds/ethereum/mainnet/uni-usd
 // and Etherscan's verified Chainlink CRV/USD feed contract.
 '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984':Object.freeze({
  symbol:'UNI',feed:'0x553303d460ee0afb37edff9be42922d8ff63220e',decimals:8,
  basis:'Ethereum Chainlink UNI/USD reference; canonical Uniswap UNI ERC-20.'
 }),
 '0xd533a949740bb3306d119cc777fa900ba034cd52':Object.freeze({
  symbol:'CRV',feed:'0xcd627aa160a6fa45eb793d19ef54f5062f20f33f',decimals:8,
  basis:'Ethereum Chainlink CRV/USD reference; canonical Curve DAO CRV ERC-20.'
 }),
 // USD oracle reference prices for exact Ethereum ERC-20 contracts. No DEX
 // market-cap, liquidity, volume or circulating-supply claims are inferred.
 '0x0d8775f648430679a709e98d2b0cb6250d2887ef':Object.freeze({
  symbol:'BAT',feed:'0x9441d7556e7820b5ca42082cfa99487d56aca958',decimals:8,
  basis:'Ethereum Chainlink BAT/USD reference; canonical Basic Attention Token ERC-20.'
 }),
 '0xc00e94cb662c3520282e6f5717214004a7f26888':Object.freeze({
  symbol:'COMP',feed:'0xdbd020caef83efd542f4de03e3cf0c28a4428bd5',decimals:8,
  basis:'Ethereum Chainlink COMP/USD reference; canonical Compound governance ERC-20.'
 }),
 '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9':Object.freeze({
  symbol:'AAVE',feed:'0x547a514d5e3769680ce22b2361c10ea13619e8a9',decimals:8,
  basis:'Ethereum Chainlink AAVE/USD reference; verified Aave ERC-20 contract.'
 }),
 '0x514910771af9ca656af840dff83e8264ecf986ca':Object.freeze({
  symbol:'LINK',feed:'0x2c1d072e956affc0d435cb7ac38ef18d24d9127c',decimals:8,
  basis:'Ethereum Chainlink LINK/USD reference; verified Chainlink ERC-20 contract.'
 }),
 '0x6b175474e89094c44da98b954eedeac495271d0f':Object.freeze({
  symbol:'DAI',feed:'0xaed0c38402a5d19df6e4c03f4e2dced6e29c1ee9',decimals:8,
  basis:'Ethereum Chainlink DAI/USD reference; verified Maker DAI ERC-20 contract.'
 }),
 '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2':Object.freeze({
  symbol:'WETH',feed:'0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',decimals:8,
  basis:'Ethereum Chainlink ETH/USD reference; canonical WETH contract is redeemable for ETH at 1:1.'
 }),
 '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':Object.freeze({
  symbol:'USDC',feed:'0x8fffffd4afb6115b954bd326cbe7b4ba576818f6',decimals:8,
  basis:'Ethereum Chainlink USDC/USD reference feed for the exact USDC contract.'
 })
});
const FEED='0xfeaf968c',DECIMALS='0x313ce567';
const word=(hex,index)=>{
 if(typeof hex!=='string'||!/^0x(?:[0-9a-f]{64}){5}$/i.test(hex))throw Error('Invalid Chainlink round data');
 return '0x'+hex.slice(2+index*64,2+(index+1)*64);
};
function failure(reason,reasonCode='ORACLE_UNAVAILABLE'){
 return {priceUsd:{value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',
  reason,reasonCode,source:null,evidence:[],chainId:CHAIN_ID,network:NETWORK}};
}
async function inspect(address,block,{rpcCall=rpc,now=Date.now()}={}){
 if(typeof address!=='string'||!/^0x[0-9a-f]{40}$/i.test(address)||!/^0x[0-9a-f]+$/i.test(block||''))
  return failure('Exact Ethereum token and pinned block are required.','INVALID_INPUT');
 const token=address.toLowerCase(),asset=ASSETS[token];
 if(!asset)return failure('No exact-contract Chainlink USD feed is configured for this Ethereum token.','NO_EXACT_ORACLE_FEED');
 const [decimalsWord,round,blockData]=await Promise.all([
  rpcCall('eth_call',[{to:asset.feed,data:DECIMALS},block]),
  rpcCall('eth_call',[{to:asset.feed,data:FEED},block]),
  rpcCall('eth_getBlockByNumber',[block,false])
 ]);
 if(Number(uint(decimalsWord))!==asset.decimals)throw Error('Unexpected Chainlink feed precision');
 const unsigned=BigInt(word(round,1));
 const answer=unsigned>=(1n<<255n)?unsigned-(1n<<256n):unsigned;
 const updatedAt=Number(BigInt(word(round,3)));
 const id=BigInt(word(round,0)),answered=BigInt(word(round,4)),startedAt=Number(BigInt(word(round,2)));
 const roundId=id.toString();
 const blockTimestamp=Number(BigInt(blockData?.timestamp||'0x0'));
 if(answer<=0n||id<=0n||id>=(1n<<80n)||answered<id||answered>=(1n<<80n)||
   !Number.isSafeInteger(startedAt)||startedAt<=0||startedAt>updatedAt||
   !Number.isSafeInteger(updatedAt)||updatedAt<=0||
   !Number.isSafeInteger(blockTimestamp)||updatedAt>blockTimestamp)
  return failure('Oracle answer or timestamp is not valid at the pinned Ethereum block.','INVALID_ORACLE_ANSWER');
 const ageSeconds=Math.floor(now/1000)-updatedAt;
 if(ageSeconds<0||ageSeconds>86400)
  return failure('Chainlink answer is older than 24 hours.','STALE_ORACLE_ANSWER');
 const value=Number(answer)/10**asset.decimals;
 if(!Number.isFinite(value)||value<=0)return failure('Oracle USD answer is outside the supported numeric range.','INVALID_ORACLE_ANSWER');
 return {priceUsd:{value,status:'ON_CHAIN_ORACLE',dataState:'DATA_FOUND',
  source:'Chainlink Data Feed via Ethereum RPC',network:NETWORK,chainId:CHAIN_ID,
  evidence:[{provider:'Chainlink Data Feed',network:NETWORK,chainId:CHAIN_ID,
   token,feed:asset.feed,block,roundId,updatedAt:new Date(updatedAt*1000).toISOString(),
   ageSeconds,basis:asset.basis,
   scope:'Oracle reference price only. Not a DEX execution price, market cap, circulating supply, volume, liquidity, or 24h change.'}]}};
}
module.exports={ASSETS,word,failure,inspect};
