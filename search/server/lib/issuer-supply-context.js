'use strict';
// OPTIONAL source-backed custody context: never derived circulating supply or
// a claim that a currently-held balance is contract-enforced locked supply.
const {rpc,uint,units}=require('./eth');
const TOKEN='0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3';
const WALLET='0x677fd4ed8ae623f2f625deb2d64f2070e46ca1a1';
const OFFICIAL='https://blog.ondo.foundation/ondo-foundation-group-wallet-address-disclosure/';
const HEX=/^0x[0-9a-f]+$/i;
const timeout=(work,ms)=>new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('SOURCE_CUSTODY_TIMEOUT')),ms);
 Promise.resolve().then(work).then(v=>{clearTimeout(timer);resolve(v)},e=>{clearTimeout(timer);reject(e)});
});
async function inspect({network,chainId,address,block,token,totalSupplyRaw,rpcReader=rpc}={}){
 if(network!=='ethereum'||chainId!==1||typeof address!=='string'||address.toLowerCase()!==TOKEN||
  !HEX.test(block||'')||!Number.isInteger(token?.decimals)||token.decimals<0||token.decimals>36||
  !/^[1-9]\d*$/.test(String(totalSupplyRaw||'')))return null;
 let raw;
 try{
  const result=await timeout(()=>rpcReader('eth_call',[{
   to:TOKEN,data:'0x70a08231'+WALLET.slice(2).padStart(64,'0')
  },block],{timeoutMs:2900}),3200);
  if(typeof result!=='string'||!/^0x[0-9a-f]{64}$/i.test(result))return null;
  raw=uint(result);
  if(raw>BigInt(totalSupplyRaw))return null;
 }catch{return null}
 const balance=units(raw,token.decimals);
 return {
  observations:[{
   kind:'ISSUER_DISCLOSED_WALLET_CURRENT_CUSTODY',
   chainId:1,network:'ethereum',address:TOKEN,
   wallet:WALLET,block,rawBalance:raw.toString(),decimals:token.decimals,balance,
   source:'Ondo Foundation wallet disclosure + pinned Ethereum RPC balanceOf()',
   sourceUrl:OFFICIAL,issuerDisclosureUpdated:'2026-08-26',
   method:'balanceOf(issuer-disclosed custody wallet)',
   limitation:'Foundation identified this address as holding locked ONDO in its disclosure. The present wallet balance is on-chain custody only. It does not establish current locked amount, full vesting, circulating supply, or next unlock date.'
  }],
  researchNotes:[
   'Ondo Foundation disclosed a locked-token custody wallet (updated 26 Aug 2026). Its current on-chain ONDO balance at block '+block+' is '+balance+' ONDO. This is custody evidence, NOT verified circulating or currently locked supply.'
  ]
 };
}
module.exports={inspect,TOKEN,WALLET,OFFICIAL};
