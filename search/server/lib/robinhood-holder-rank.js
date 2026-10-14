'use strict';
// Blockscout supplies a contract-scoped, balance-sorted candidate list. The
// published top-wallet percentages are accepted only when the first 20 rows
// reconcile to direct Robinhood RPC balanceOf reads at the report's pinned
// block. A stale or incomplete indexer response stays NOT_VERIFIED.
const {readJson}=require('./http');
const {rpc}=require('./robinhood-rpc');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const BASE='https://robinhoodchain.blockscout.com/api/v2/tokens/';
function rows(body){
 if(!body||!Array.isArray(body.items))return null;
 const result=[],seen=new Set();
 for(const item of body.items.slice(0,20)){
  const raw=item?.address?.hash??item?.address_hash??item?.address;
  const address=typeof raw==='string'?raw.toLowerCase():'';
  const value=typeof item?.value==='string'?item.value:null;
  if(!ADDRESS.test(address)||seen.has(address)||value===null||!/^(?:0|[1-9]\d*)$/.test(value))return null;
  const amount=BigInt(value);
  if(amount<=0n||(result.length&&result.at(-1).amount<amount))return null;
  seen.add(address);result.push({address,amount});
 }
 return result;
}
function percentage(raw,totalRaw){
 if(typeof totalRaw!=='string'||!/^[1-9]\d*$/.test(totalRaw)||raw<=0n)return null;
 const total=BigInt(totalRaw);
 if(raw>total)return null;
 const scale=10n**12n;
 return Number((raw*100n*scale+total/2n)/total)/1e12;
}
async function fetchRank(address,{block,totalSupplyRaw,fetcher=fetch,rpcCall=rpc}={}){
 if(typeof address!=='string'||!ADDRESS.test(address)||!/^0x[0-9a-f]+$/i.test(block||'')||
  typeof totalSupplyRaw!=='string'||!/^[1-9]\d*$/.test(totalSupplyRaw))return null;
 const token=address.toLowerCase();
 try{
  const url=BASE+token+'/holders';
  const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)return null;
  const ranked=rows(await readJson(response,1024*1024));
  if(!ranked||ranked.length<10)return null;
  const reconciled=await Promise.all(ranked.map(async row=>{
   const word=await rpcCall('eth_call',[{to:token,data:'0x70a08231'+row.address.slice(2).padStart(64,'0')},block]);
   if(typeof word!=='string'||!/^0x[0-9a-f]{64}$/i.test(word))throw Error('Invalid pinned balance');
   const balance=BigInt(word);
   if(balance!==row.amount)throw Error('Blockscout balance is not current at the pinned block');
   return {address:row.address,balance};
  }));
  const largest=percentage(reconciled[0]?.balance, totalSupplyRaw);
  const top10=reconciled.length>=10?percentage(reconciled.slice(0,10).reduce((sum,row)=>sum+row.balance,0n),totalSupplyRaw):null;
  const top20=reconciled.length>=20?percentage(reconciled.slice(0,20).reduce((sum,row)=>sum+row.balance,0n),totalSupplyRaw):null;
  if(largest===null||top10===null)return null;
  const evidence=[{network:'robinhood',chainId:4663,address:token,sourceUrl:url,block,
   method:'Blockscout balance-sorted top-20 + RPC balanceOf(wallet) reconciliation',
   matchedWallets:reconciled.length,scope:'Blockscout rank is source-reported; all displayed balances matched Robinhood RPC at the pinned block. Supply denominator is on-chain totalSupply. This is wallet concentration, not beneficial-owner concentration.'}];
  const found=(value,method)=>({value,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:'Robinhood RPC + Blockscout',network:'robinhood',chainId:4663,
   evidence:evidence.map(item=>({...item,method}))});
  return {largestWalletPct:found(largest,'largest Blockscout-ranked wallet balance / totalSupply()'),
   top10Pct:found(top10,'sum of first 10 Blockscout-ranked balances / totalSupply()'),
   ...(top20===null?{}:{top20Pct:found(top20,'sum of first 20 Blockscout-ranked balances / totalSupply()')})};
 }catch{return null;}
}
module.exports={rows,percentage,fetchRank};

