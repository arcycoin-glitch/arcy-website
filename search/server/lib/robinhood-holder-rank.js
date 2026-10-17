'use strict';
// Blockscout supplies a contract-scoped, balance-sorted candidate list. The
// published top-wallet percentages are accepted only when the first 20 rows
// reconcile to direct Robinhood RPC balanceOf reads at the report's pinned
// block. A stale or incomplete indexer response stays NOT_VERIFIED.
const {readJson}=require('./http');
const {rpc}=require('./robinhood-rpc');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const BASE='https://robinhoodchain.blockscout.com/api/v2/tokens/';
const unavailable=reasonCode=>({reasonCode});
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
  typeof totalSupplyRaw!=='string'||!/^[1-9]\d*$/.test(totalSupplyRaw))return unavailable('HOLDER_RANK_INPUT_INVALID');
 const token=address.toLowerCase();
 try{
  const url=BASE+token+'/holders';
  const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)return unavailable('BLOCKSCOUT_HOLDERS_HTTP_'+response.status);
  const ranked=rows(await readJson(response,1024*1024));
  if(!ranked)return unavailable('BLOCKSCOUT_HOLDERS_SCHEMA_INVALID');
  if(ranked.length===0)return unavailable('BLOCKSCOUT_HOLDERS_EMPTY');
  let reconciled;
  try{reconciled=Array(ranked.length);let cursor=0;
   await Promise.all(Array.from({length:Math.min(4,ranked.length)},async()=>{for(;;){
   const i=cursor++;if(i>=ranked.length)return;const row=ranked[i];
   const word=await rpcCall('eth_call',[{to:token,data:'0x70a08231'+row.address.slice(2).padStart(64,'0')},block]);
   if(typeof word!=='string'||!/^0x[0-9a-f]{64}$/i.test(word))throw Error('Invalid pinned balance');
   const balance=BigInt(word);
   if(balance!==row.amount)throw Error('Blockscout balance is not current at the pinned block');
   reconciled[i]={address:row.address,balance};
  }}));}catch{return unavailable('BLOCKSCOUT_RANK_RPC_RECONCILIATION_FAILED')}
  const total=BigInt(totalSupplyRaw);
  const observed=reconciled.reduce((sum,row)=>sum+row.balance,0n);
  if(observed>total)return unavailable('BLOCKSCOUT_RANK_SUPPLY_RECONCILIATION_FAILED');
  // With fewer than 20 indexed holders, a complete census can still be
  // proven when pinned positive balances sum EXACTLY to totalSupply().
  // An incomplete list must never be padded into a fictitious top 10/20.
  const censusComplete=observed===total;
  if(reconciled.length<10&&!censusComplete)
   return unavailable('BLOCKSCOUT_RANK_BELOW_TEN_ROWS');
  const largest=percentage(reconciled[0]?.balance,totalSupplyRaw);
  const top10=percentage(reconciled.slice(0,10).reduce((sum,row)=>sum+row.balance,0n),totalSupplyRaw);
  const top20=(reconciled.length>=20||censusComplete)?
   percentage(reconciled.slice(0,20).reduce((sum,row)=>sum+row.balance,0n),totalSupplyRaw):null;
  if(largest===null||top10===null||((reconciled.length>=20||censusComplete)&&top20===null))
   return unavailable('BLOCKSCOUT_RANK_SUPPLY_RECONCILIATION_FAILED');
  const evidence=[{network:'robinhood',chainId:4663,address:token,sourceUrl:url,block,
   method:'Blockscout sorted holder candidates + pinned Robinhood RPC balanceOf(wallet) reconciliation',
   matchedWallets:reconciled.length,censusComplete,verifiedPositiveHolderCount:censusComplete?reconciled.length:null,
   scope:censusComplete?
    'Every positive balance candidate matched RPC and together they account for 100% of totalSupply at the same block. For fewer than 10/20 holders, the respective top percentage includes every wallet. Wallets do not imply distinct beneficial owners.':
    'Top wallet candidates and their balances matched Robinhood RPC at the pinned block; this does NOT prove the candidate list is exhaustive or that unlisted wallets are absent.'}];
  const found=(value,method)=>({value,status:censusComplete?'ONCHAIN_RECONCILED':'SOURCE_REPORTED_RPC_RECONCILED',
   dataState:'DATA_FOUND',source:'Robinhood RPC + Blockscout',network:'robinhood',chainId:4663,
   evidence:evidence.map(item=>({...item,method}))});
  return {
   ...(censusComplete?{holderCount:found(reconciled.length,'count of reconciled positive-balance token wallets')}:{}),
   largestWalletPct:found(largest,'largest Blockscout-ranked wallet balance / totalSupply()'),
   top10Pct:found(top10,'sum of up to 10 pinned wallet balances / totalSupply()'),
   ...(top20===null?{}:{top20Pct:found(top20,'sum of up to 20 pinned wallet balances / totalSupply()')})
  };
 }catch{return unavailable('BLOCKSCOUT_HOLDERS_REQUEST_FAILED');}
}
module.exports={rows,percentage,fetchRank};

