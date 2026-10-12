'use strict';
// ARCY SEARCH multichain lab foundations.
// This module is opt-in. The existing Ethereum endpoints remain unchanged.
const CHAIN_CONFIG=Object.freeze({
 ethereum:Object.freeze({
  id:'ethereum',label:'Ethereum',chainId:1,rpcEnv:'ETH_RPC_URL',
  publicRpc:'https://ethereum-rpc.publicnode.com',
  explorer:'https://eth.blockscout.com',
  blockscoutTokens:'https://eth.blockscout.com/api/v2/tokens/',
  goPlusChainId:1,
  stockTokenRegistry:null
 }),
 arc:Object.freeze({
  id:'arc',label:'Arc',chainId:5042,rpcEnv:'ARC_RPC_URL',
  publicRpc:'https://rpc.mainnet.arc.io',
  explorer:'https://explorer.arc.io',
  blockscoutTokens:null,
  goPlusChainId:null,
  stockTokenRegistry:null
 }),
  robinhood:Object.freeze({
  id:'robinhood',label:'Robinhood Chain',chainId:4663,rpcEnv:'ROBINHOOD_RPC_URL',
  publicRpc:'https://rpc.mainnet.chain.robinhood.com',
  explorer:'https://robinhoodchain.blockscout.com',
  blockscoutTokens:'https://robinhoodchain.blockscout.com/api/v2/tokens/',
  // Do NOT assume the security API supports this chain until verified by live fixtures.
  goPlusChainId:null,
  stockTokenRegistry:'https://api.robinhood.com/rhj/assets'
 })
});
function chain(input='ethereum'){
 if(typeof input!=='string')throw Error('Network must be a string');
 const normalized=input.toLowerCase();
 if(input!==normalized||!Object.hasOwn(CHAIN_CONFIG,normalized))throw Error('Unsupported network');
 return CHAIN_CONFIG[normalized];
}
function rpcUrl(input='ethereum',env=process.env){
 const cfg=chain(input);
 const supplied=env[cfg.rpcEnv]||cfg.publicRpc;
 if(typeof supplied!=='string')throw Error('Invalid RPC configuration');
 let url;
 try{url=new URL(supplied)}catch{throw Error('Invalid RPC URL')}
 const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 const loopback=['localhost','127.0.0.1','::1'].includes(host);
 if(url.username||url.password||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&loopback)))throw Error('RPC must use HTTPS (or loopback HTTP), without credentials');
 return url.toString();
}
function verifyChainId(network,raw){
 const expected=chain(network).chainId;
 if(typeof raw!=='string'||!/^0x[0-9a-f]+$/i.test(raw)||Number(BigInt(raw))!==expected)
  throw Error('RPC chain ID mismatch');
 return expected;
}
module.exports={CHAIN_CONFIG,chain,rpcUrl,verifyChainId};
