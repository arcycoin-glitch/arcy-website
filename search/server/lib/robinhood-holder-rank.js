'use strict';
// Blockscout supplies a contract-scoped, balance-sorted candidate list. The
// top-wallet samples use balanceOf on the report's pinned Robinhood block,
// independently of live explorer balance values. Explorer candidate membership
// stays SOURCE_REPORTED; the snapshot never claims exhaustive global ranking.
const {readJson}=require('./http');
const {rpc}=require('./robinhood-rpc');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const BASE='https://robinhoodchain.blockscout.com/api/v2/tokens/';
const PRO='https://api.blockscout.com/4663/api/v2/tokens/';
const API_KEY=/^proapi_[A-Za-z0-9_-]{8,120}$/;
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
const MAX_CENSUS_HOLDERS=60;
const MAX_CENSUS_PAGES=2;
const CURSOR_KEYS=new Set(['address_hash','value','items_count']);
function parseCensusPage(body){
 if(!body||!Array.isArray(body.items)||body.items.length>50)return null;
 const result=[],seen=new Set();
 for(const item of body.items){
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
async function completeCandidates(firstBody,requestUrl,expected,fetcher){
 if(!Number.isSafeInteger(expected)||expected<1||expected>MAX_CENSUS_HOLDERS)return null;
 const all=[],seen=new Set(),cursors=new Set();
 let body=firstBody,url=new URL(requestUrl),complete=false;
 for(let page=0;page<MAX_CENSUS_PAGES;page++){
  const parsed=parseCensusPage(body);
  if(!parsed||!parsed.length)return null;
  for(const row of parsed){
   if(seen.has(row.address)||(all.length&&all.at(-1).amount<row.amount))return null;
   seen.add(row.address);all.push(row);
   if(all.length>expected)return null;
  }
  const next=body.next_page_params??null;
  if(next===null){complete=true;break;}
  if(!next||typeof next!=='object'||Array.isArray(next))return null;
  const cursor={};
  for(const [key,value] of Object.entries(next)){
   if(!CURSOR_KEYS.has(key))return null;
   if(key==='address_hash'){
    if(typeof value!=='string'||!ADDRESS.test(value))return null;
   }else if(key==='value'){
    if(typeof value!=='string'||!/^(?:0|[1-9]\d*)$/.test(value))return null;
   }else if(key==='items_count'&&(!Number.isInteger(value)||value<0||value>MAX_CENSUS_HOLDERS))return null;
   cursor[key]=value;
  }
  if(!Object.keys(cursor).length)return null;
  const serial=JSON.stringify(cursor);
  if(cursors.has(serial))return null;
  cursors.add(serial);
  if(page+1>=MAX_CENSUS_PAGES)return null;
  url=new URL(requestUrl);
  for(const [key,value] of Object.entries(cursor))url.searchParams.set(key,String(value));
  const response=await fetcher(url.href,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)return null;
  body=await readJson(response,1024*1024);
 }
 return complete&&all.length===expected?all:null;
}
function percentage(raw,totalRaw){
 if(typeof totalRaw!=='string'||!/^[1-9]\d*$/.test(totalRaw)||raw<=0n)return null;
 const total=BigInt(totalRaw);
 if(raw>total)return null;
 const scale=10n**12n;
 return Number((raw*100n*scale+total/2n)/total)/1e12;
}
async function fetchRank(address,{block,totalSupplyRaw,reportedHolderCount,reportedHolderCountPromise,fetcher=fetch,rpcCall=rpc,verifyBlock,key=process.env.BLOCKSCOUT_API_KEY}={}){
 if(typeof address!=='string'||!ADDRESS.test(address)||!/^0x[0-9a-f]+$/i.test(block||'')||
  typeof totalSupplyRaw!=='string'||!/^[1-9]\d*$/.test(totalSupplyRaw))return unavailable('HOLDER_RANK_INPUT_INVALID');
 const token=address.toLowerCase();
 try{
  const publicUrl=BASE+token+'/holders';
  const endpoints=[publicUrl];
  if(typeof key==='string'&&API_KEY.test(key)){
   const pro=new URL(PRO+token+'/holders');
   pro.searchParams.set('apikey',key);
   endpoints.push(pro.href);
  }
  let response=null,sourceUrl=null,requestUrl=null,lastStatus=null;
  for(const url of endpoints){
   try{
    const attempt=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
    if(!attempt.ok){lastStatus=attempt.status;continue;}
    response=attempt;requestUrl=url;sourceUrl=url.replace(/[?].*$/,'');break;
   }catch{} // Another approved Blockscout endpoint may remain available.
  }
  if(!response)return unavailable(lastStatus===null?'BLOCKSCOUT_HOLDERS_REQUEST_FAILED':'BLOCKSCOUT_HOLDERS_HTTP_'+lastStatus);
  const firstBody=await readJson(response,1024*1024);
  const ranked=rows(firstBody);
  if(!ranked)return unavailable('BLOCKSCOUT_HOLDERS_SCHEMA_INVALID');
  if(ranked.length===0)return unavailable('BLOCKSCOUT_HOLDERS_EMPTY');
  if(reportedHolderCountPromise){
   try{const result=await reportedHolderCountPromise;reportedHolderCount=result?.value??result;}catch{reportedHolderCount=undefined;}
  }
  let censusRows=null;
  if(Number.isSafeInteger(reportedHolderCount)&&reportedHolderCount<=MAX_CENSUS_HOLDERS){
   try{censusRows=await completeCandidates(firstBody,requestUrl,reportedHolderCount,fetcher);}catch{censusRows=null;}
  }
  if(typeof verifyBlock==='function'){
   try{await verifyBlock();}catch{return unavailable('ROBINHOOD_BLOCK_ANCHOR_CHANGED');}
  }
  const readRows=censusRows||ranked;
  const balances=Array(readRows.length).fill(null);let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,readRows.length)},async()=>{for(;;){
   const i=cursor++;if(i>=readRows.length)return;const row=readRows[i];
   try{
    const word=await rpcCall('eth_call',[{to:token,data:'0x70a08231'+row.address.slice(2).padStart(64,'0')},block]);
    if(typeof word==='string'&&/^0x[0-9a-f]{64}$/i.test(word)){
     const balance=BigInt(word);
     if(balance>0n)balances[i]={address:row.address,balance};
    }
   }catch{}
  }}));
  if(ranked.some((row,i)=>i<ranked.length&&(!balances[i]||balances[i].address!==row.address)))
   return unavailable('BLOCKSCOUT_RANK_RPC_RECONCILIATION_FAILED');
  if(typeof verifyBlock==='function'){
   try{await verifyBlock();}catch{return unavailable('ROBINHOOD_BLOCK_ANCHOR_CHANGED');}
  }
  const total=BigInt(totalSupplyRaw);
  const censusTotal=balances.every(Boolean)?balances.reduce((sum,row)=>sum+row.balance,0n):null;
  const countMatches=!Number.isSafeInteger(reportedHolderCount)||reportedHolderCount===readRows.length;
  const censusComplete=Boolean(censusTotal===total&&countMatches);
  // If the bounded population does not reconcile exactly, retain the established top-20 sample behavior.
  let reconciled=censusComplete?balances:balances.slice(0,ranked.length);
  // Re-rank the reported candidate set by independently pinned balances.
  // Partial samples do not establish ranks of wallets omitted by the explorer.
  reconciled.sort((a,b)=>a.balance>b.balance?-1:a.balance<b.balance?1:a.address.localeCompare(b.address));
  const observed=reconciled.reduce((sum,row)=>sum+row.balance,0n);
  if(observed>total)return unavailable('BLOCKSCOUT_RANK_SUPPLY_RECONCILIATION_FAILED');
  // A complete census is emitted only when every bounded source address was
  // pinned-read and their positive balances exactly equal totalSupply().
  if(reconciled.length<10&&!censusComplete)
   return unavailable('BLOCKSCOUT_RANK_BELOW_TEN_ROWS');
  // Burn custody (zero/0xdead) is reconciled into supply but never ranked as a wallet (same rule as Arc).
  const A=require('./holder-attribution'),wallets=reconciled.filter(row=>!A.isBurn(row.address)),excluded=reconciled.filter(row=>A.isBurn(row.address));
  if(wallets.length<10&&!censusComplete)return unavailable('BLOCKSCOUT_RANK_BELOW_TEN_NON_BURN_ROWS');
  if(!wallets.length)return unavailable('NO_NON_BURN_HOLDERS');
  const largest=percentage(wallets[0]?.balance,totalSupplyRaw);
  const top10=percentage(wallets.slice(0,10).reduce((sum,row)=>sum+row.balance,0n),totalSupplyRaw);
  const top20=(wallets.length>=20||censusComplete)?
   percentage(wallets.slice(0,20).reduce((sum,row)=>sum+row.balance,0n),totalSupplyRaw):null;
  if(largest===null||top10===null||((wallets.length>=20||censusComplete)&&top20===null))
   return unavailable('BLOCKSCOUT_RANK_SUPPLY_RECONCILIATION_FAILED');
  const evidence=[{network:'robinhood',chainId:4663,address:token,sourceUrl,block,
   method:'Blockscout sorted holder candidates + pinned Robinhood RPC balanceOf(wallet) reconciliation',
   matchedWallets:reconciled.length,censusComplete,verifiedPositiveHolderCount:censusComplete?reconciled.length:null,
   explorerBalanceAtDifferentBlockIgnored:true,sourceRankCompleteness:censusComplete?'ONCHAIN_RECONCILED':'SOURCE_REPORTED',...A.concentrationScope(excluded),holderCountIncludesBurnAddresses:censusComplete&&excluded.length>0,
   scope:censusComplete?
    'Every positive balance candidate matched RPC and together they account for 100% of totalSupply at the same block. For fewer than 10/20 holders, the respective top percentage includes every wallet. Wallets do not imply distinct beneficial owners.':
    'Blockscout supplied candidate addresses; their balances were read and re-ranked from Robinhood RPC at the pinned block. The sample may OMIT higher-ranked wallets. These are concentration measurements of source-ranked candidates, not independently established chain-wide top 10/20.'}];
  const found=(value,method)=>({value,status:censusComplete?'ONCHAIN_RECONCILED':'SOURCE_REPORTED_RPC_RECONCILED',
   dataState:'DATA_FOUND',source:'Robinhood RPC + Blockscout',network:'robinhood',chainId:4663,
   evidence:evidence.map(item=>({...item,method}))});
  return {
   ...(censusComplete?{holderCount:found(reconciled.length,'count of reconciled positive-balance token wallets')}:{}),
   largestWalletPct:found(largest,'largest pinned balance among Blockscout-ranked candidate wallets / totalSupply()'),
   top10Pct:found(top10,'sum of up to 10 pinned balances among source-ranked candidate wallets / totalSupply()'),
   ...(top20===null?(excluded.length&&wallets.length<20?{top20Pct:{value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',source:null,evidence:[],network:'robinhood',chainId:4663,reasonCode:'BURN_EXCLUSION_RANK_INCOMPLETE',reason:'Burn addresses took explorer candidate slots; fewer than 20 real wallets remain to rank.'}}:{}):{top20Pct:found(top20,'sum of up to 20 pinned balances among source-ranked candidate wallets / totalSupply()')})
  };
 }catch{return unavailable('BLOCKSCOUT_HOLDERS_REQUEST_FAILED');}
}
module.exports={rows,percentage,fetchRank,completeCandidates,MAX_CENSUS_HOLDERS};

