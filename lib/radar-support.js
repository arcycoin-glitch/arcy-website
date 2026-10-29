'use strict';
// Self-contained helpers for the Radar modules under lib/. The Railway Holder
// image (Dockerfile.holder-worker) copies ONLY package.json, lib/ and two
// scripts — never search/ — so nothing in lib/ may statically require a path
// outside lib/. These are exact copies of search/server/lib/{chains,eth}.js
// helpers; test/radar-support-parity.test.js fails if the originals drift.
const CHAIN_CONFIG=Object.freeze({
 ethereum:Object.freeze({id:'ethereum',chainId:1,rpcEnv:'ETH_RPC_URL',publicRpc:'https://ethereum-rpc.publicnode.com'}),
 arc:Object.freeze({id:'arc',chainId:5042,rpcEnv:'ARC_RPC_URL',publicRpc:'https://rpc.mainnet.arc.io'}),
 robinhood:Object.freeze({id:'robinhood',chainId:4663,rpcEnv:'ROBINHOOD_RPC_URL',publicRpc:'https://rpc.mainnet.chain.robinhood.com'})
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
function abiString(hex){
 if(typeof hex!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(hex))return null;
 const bytes=Buffer.from(hex.slice(2),'hex');
 if(bytes.length===32)return bytes.toString('utf8').replace(/\0+$/,'').trim()||null;
 if(bytes.length<64)return null;
 const offset=Number(BigInt('0x'+bytes.subarray(0,32).toString('hex')));
 if(!Number.isSafeInteger(offset)||offset<32||offset+32>bytes.length)return null;
 const len=Number(BigInt('0x'+bytes.subarray(offset,offset+32).toString('hex')));
 return Number.isSafeInteger(len)&&len>=0&&len<=512&&offset+32+len<=bytes.length?bytes.subarray(offset+32,offset+32+len).toString('utf8').trim()||null:null;
}
// Logos live in the Vercel app only. In the Holder image the optional module is
// absent, so logos stay null and the Vercel API decorates them at serve time.
function localLogo(network,address){
 try{return require(['..','search','server','lib','search-logo'].join('/')).localLogo(network,address);}catch{return null;}
}
module.exports={CHAIN_CONFIG,chain,rpcUrl,abiString,localLogo};
