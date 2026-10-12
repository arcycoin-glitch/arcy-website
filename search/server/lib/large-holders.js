'use strict';
/**
 * Large Ethereum ERC-20 holders: source-ranked, independently balance-checked
 * candidate snapshot. We NEVER call this chain-wide ranking "on-chain verified".
 * Blockscout has a balance-sorted holders endpoint, but RPC balanceOf alone
 * cannot prove another undiscovered holder does not outrank these candidates.
 */
const {rpc,ADDRESS,uint}=require('./eth');
const {found,unknown,card}=require('./evidence');
const {readJson}=require('./http');
const BASE='https://eth.blockscout.com/api/v2/tokens/';
const TOP_SIZE=21; // top 20 plus rank #21 as an ordering boundary
const MAX_REQUEST_TIMEOUT_MS=8500;
function absent(reason,code='RANKED_SNAPSHOT_NOT_VERIFIED'){
 return Object.fromEntries(['largestWalletPct','top10Pct','top20Pct'].map(k=>[k,unknown(reason,code)]));
}
function parsePage(payload,contract){
 if(!payload||!Array.isArray(payload.items)||payload.items.length<TOP_SIZE)return {ok:false,reasonCode:'INSUFFICIENT_RANK_CANDIDATES'};
 const first=payload.items.slice(0,TOP_SIZE);
 const seen=new Set(),rows=[];
 for(const item of first){
  const address=typeof item?.address==='string'?item.address:item?.address?.hash||item?.address_hash;
  const value=item?.value;
  if(!ADDRESS.test(address||'')||typeof value!=='string'||!/^[1-9][0-9]*$/.test(value))return {ok:false,reasonCode:'INVALID_RANK_ROW'};
  const addr=address.toLowerCase();
  if(seen.has(addr))return {ok:false,reasonCode:'DUPLICATE_RANK_ADDRESS'};
  seen.add(addr);
  rows.push({address:addr,balance:BigInt(value)});
 }
 for(let i=1;i<rows.length;i++){
  if(rows[i-1].balance<rows[i].balance)return {ok:false,reasonCode:'EXPLORER_RANK_ORDER_FAILED'};
 }
 return {ok:true,rows,source:'Blockscout',contract};
}
function percentage(raw,total){
 if(typeof raw!=='bigint'||typeof total!=='bigint'||total<=0n||raw<0n||raw>total)return null;
 return Number((raw*1000000n+total/2n)/total)/10000;
}
function evaluate(page,chainBalances,totalSupply,block,token,count){
 if(!page?.ok||!Array.isArray(chainBalances)||chainBalances.length<TOP_SIZE||typeof totalSupply!=='bigint'||totalSupply<=0n||!/^0x[0-9a-f]+$/i.test(block||''))return {ok:false,reasonCode:'MISSING_PINNED_RANK_EVIDENCE'};
 const rows=page.rows;
 for(let i=0;i<TOP_SIZE;i++){
  if(typeof chainBalances[i]!=='bigint'||chainBalances[i]<=0n||chainBalances[i]!==rows[i].balance)return {ok:false,reasonCode:'EXPLORER_RPC_BALANCE_MISMATCH'};
 }
 const twenty=chainBalances.slice(0,20);
 const sum=twenty.reduce((a,b)=>a+b,0n);
 if(sum>totalSupply)return {ok:false,reasonCode:'TOP_BALANCES_EXCEED_SUPPLY'};
 const first=percentage(twenty[0],totalSupply);
 const top10=percentage(twenty.slice(0,10).reduce((a,b)=>a+b,0n),totalSupply);
 const top20=percentage(sum,totalSupply);
 if([first,top10,top20].some(x=>x===null||!Number.isFinite(x)))return {ok:false,reasonCode:'INVALID_CONCENTRATION'};
 const proof=[{
   source:'Blockscout + Ethereum RPC',token,block,
   providerRank:'Blockscout balance-sorted holder list, positions 1–21',
   method:'balanceOf(address) for positions 1–21, all at same Ethereum block',
   rpcMatchesExplorerValues:true,
   rankBoundary:'Rank 21 is positive and not greater than rank 20',
   reportedHolderCount:count,
   limitation:'Rank completeness and holder count remain explorer-reported. RPC verifies candidate balances, not the absence of a larger unlisted wallet; beneficiary control and clustered wallets are not proven.'
 }];
 return {ok:true,fields:{
  largestWalletPct:found(first,'Blockscout ranked holders + Ethereum RPC',proof,'SOURCE_REPORTED_RPC_RECONCILED'),
  top10Pct:found(top10,'Blockscout ranked holders + Ethereum RPC',proof,'SOURCE_REPORTED_RPC_RECONCILED'),
  top20Pct:found(top20,'Blockscout ranked holders + Ethereum RPC',proof,'SOURCE_REPORTED_RPC_RECONCILED')
 }};
}
async function fetchPage(token){
 const r=await fetch(BASE+token+'/holders',{headers:{accept:'application/json'},signal:AbortSignal.timeout(MAX_REQUEST_TIMEOUT_MS)});
 if(!r.ok)throw Error('Blockscout ranked-holder HTTP '+r.status);
 const p=await readJson(r,512*1024);
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Malformed ranked holder response');
 return p;
}
async function readBalances(token,rows,block){
 const out=new Array(TOP_SIZE);
 const WORKERS=4;
 await Promise.all(Array.from({length:WORKERS},async(_,w)=>{
   for(let i=w;i<TOP_SIZE;i+=WORKERS){
     out[i]=uint(await rpc('eth_call',[{to:token,data:'0x70a08231'+rows[i].address.slice(2).padStart(64,'0')},block]));
   }
 }));
 return out;
}
async function inspect(token,block,supplyRaw,count,{getPage=fetchPage,getBalances=readBalances}={}){
 const missing=(code,reason)=>({status:'NOT_VERIFIED',fields:absent(reason,code),reasonCode:code});
 if(!ADDRESS.test(token)||!Number.isSafeInteger(count)||count<TOP_SIZE||typeof supplyRaw!=='string'||!/^[1-9][0-9]*$/.test(supplyRaw))return missing('INVALID_RANK_INPUT','Unverified token address, holder count or raw supply.');
 try{
  const page=parsePage(await getPage(token.toLowerCase()),token.toLowerCase());
  if(!page.ok)return missing(page.reasonCode,'Blockscout did not supply 21 well-formed, sorted, distinct ranked holders.');
  const chainBalances=await getBalances(token.toLowerCase(),page.rows,block);
  const result=evaluate(page,chainBalances,BigInt(supplyRaw),block,token.toLowerCase(),count);
  if(!result.ok)return missing(result.reasonCode,'Ranked holder candidates failed pinned Ethereum RPC reconciliation.');
  return {...card(result.fields,'Source-ranked top-20 balances reconciled with pinned Ethereum RPC; ranked completeness remains explorer-reported.'),rankedEvidence:'SOURCE_REPORTED_RPC_RECONCILED'};
 }catch(e){
  return missing('RANKED_SOURCE_API_FAILED','Blockscout or Ethereum RPC failed during source-ranked holder checks.');
 }
}
module.exports={TOP_SIZE,parsePage,percentage,evaluate,fetchPage,readBalances,inspect};
