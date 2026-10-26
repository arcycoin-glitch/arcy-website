'use strict';
/**
 * Large Ethereum ERC-20 holders: source-ranked, independently balance-checked
 * candidate snapshot. We NEVER call this chain-wide ranking "on-chain verified".
 * Blockscout has a balance-sorted holders endpoint, but RPC balanceOf alone
 * cannot prove another undiscovered holder does not outrank these candidates.
 */
const {rpc,ADDRESS,uint}=require('./eth');
const {found,unknown,card}=require('./evidence');
const source=require('./source-request').createReader({ttlMs:15000,maxEntries:32});
const BASE='https://eth.blockscout.com/api/v2/tokens/';
const TOP_SIZE=21; // top 20 plus rank #21 as an ordering boundary
const MAX_REQUEST_TIMEOUT_MS=8500;
function absent(reason,code='RANKED_SNAPSHOT_NOT_VERIFIED'){
 return Object.fromEntries(['largestWalletPct','top10Pct','top20Pct'].map(k=>[k,unknown(reason,code)]));
}
function parsePage(payload,contract){
 if(!ADDRESS.test(contract||''))return {ok:false,reasonCode:'INVALID_RANK_TOKEN'};
 const identities=[payload?.token?.address_hash,payload?.token_address].filter(x=>x!==undefined);
 if(identities.some(x=>typeof x!=='string'||x.toLowerCase()!==contract.toLowerCase())||[payload?.chain_id,payload?.chainId].filter(x=>x!==undefined).some(x=>String(x)!=='1'))return {ok:false,reasonCode:'RANK_SOURCE_IDENTITY_MISMATCH'};
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
 // Blockscout's holder values are a live indexer snapshot, not block-pinned.
 // Treat its top-21 addresses as candidates only; use the same pinned RPC
 // balances for every candidate and locally rank those current values. This
 // prevents an indexer refresh between eth_blockNumber and /holders from
 // blanking all three metrics or publishing stale balances.
 if(chainBalances.length!==page.rows.length||chainBalances.some(value=>
  typeof value!=='bigint'||value<=0n||value>totalSupply))return {ok:false,reasonCode:'INVALID_PINNED_CANDIDATE_BALANCE'};
 const rankedRows=page.rows.map((row,i)=>({address:row.address,balance:chainBalances[i]}))
  .sort((a,b)=>a.balance>b.balance?-1:a.balance<b.balance?1:a.address.localeCompare(b.address));
 const ranked=rankedRows.map(row=>row.balance);
 const twenty=ranked.slice(0,20);
 const sum=twenty.reduce((a,b)=>a+b,0n);
 if(sum>totalSupply)return {ok:false,reasonCode:'TOP_BALANCES_EXCEED_SUPPLY'};
 const first=percentage(twenty[0],totalSupply);
 const top10=percentage(twenty.slice(0,10).reduce((a,b)=>a+b,0n),totalSupply);
 const top20=percentage(sum,totalSupply);
 if([first,top10,top20].some(x=>x===null||!Number.isFinite(x)))return {ok:false,reasonCode:'INVALID_CONCENTRATION'};
 const proof=[{
   source:'Blockscout candidate addresses + Ethereum RPC',token,block,
   providerCandidates:'Blockscout current balance-ranked holder list, first 21 addresses',
   method:'balanceOf(address) for all 21 candidates at the same Ethereum block; candidate balances locally re-ranked',
   rpcBalancesUsedForPublishedMetrics:true,
   rankBoundary:'All 21 candidate addresses had positive pinned balances; the 21st candidate is retained as the boundary observation',
   reportedHolderCount:count,
   limitation:'All balances are pinned RPC values, but candidate membership and holder count are explorer-reported. This is not an exhaustive census and cannot prove an unlisted wallet is absent; beneficiary control and clustered wallets are not proven.'
 }];
 const holderCandidates=rankedRows.slice(0,20).map((row,index)=>({
  address:row.address,rank:index+1,sharePct:percentage(row.balance,totalSupply),
  role:require('./holder-attribution').classify({network:'ethereum',chainId:1,address:row.address}).role,
  block,source:'Blockscout candidate address + pinned Ethereum balanceOf',
  scope:'Source-ranked candidate, not proof of global rank or beneficial ownership.'
 }));
 return {ok:true,holderCandidates,fields:{
  largestWalletPct:found(first,'Blockscout candidate addresses + Ethereum RPC',proof,'SOURCE_REPORTED_RPC_RECONCILED'),
  top10Pct:found(top10,'Blockscout candidate addresses + Ethereum RPC',proof,'SOURCE_REPORTED_RPC_RECONCILED'),
  top20Pct:found(top20,'Blockscout candidate addresses + Ethereum RPC',proof,'SOURCE_REPORTED_RPC_RECONCILED')
 }};
}
async function fetchPage(token,{fetcher=fetch}={}){
 if(!ADDRESS.test(token||''))throw Error('Invalid ranked token address');
 // Cache only validated exact-contract candidate addresses, NEVER RPC balances
 // or computed percentages. Every report reconciles again at its own block.
 return source.json(BASE+token.toLowerCase()+'/holders',{fetcher,timeoutMs:MAX_REQUEST_TIMEOUT_MS,maxBytes:512*1024,validate:p=>parsePage(p,token).ok});
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
 let stage='CANDIDATE_SOURCE';
 try{
  const page=parsePage(await getPage(token.toLowerCase()),token.toLowerCase());
  if(!page.ok)return missing(page.reasonCode,'Blockscout did not supply 21 well-formed, sorted, distinct ranked holders.');
  stage='PINNED_RPC';
  const chainBalances=await getBalances(token.toLowerCase(),page.rows,block);
  const result=evaluate(page,chainBalances,BigInt(supplyRaw),block,token.toLowerCase(),count);
  if(!result.ok)return missing(result.reasonCode,'Ranked holder candidates failed pinned Ethereum RPC reconciliation.');
  const observed=getPage===fetchPage?source.observedAt(BASE+token.toLowerCase()+'/holders'):null;
  if(Number.isFinite(observed))for(const field of Object.values(result.fields))field.evidence[0].candidateSourceRetrievedAt=new Date(observed).toISOString();
  return {...card(result.fields,'Source-ranked top-20 balances reconciled with pinned Ethereum RPC; ranked completeness remains explorer-reported.'),
   holderCandidates:result.holderCandidates,rankedEvidence:'SOURCE_REPORTED_RPC_RECONCILED'};
 }catch(e){
  const type=[408,429,500,502,503,504,401,403,404].includes(e?.httpStatus)?'HTTP_'+e.httpStatus:/timeout/i.test(e?.name||'')||e?.code==='SOURCE_TIMEOUT'?'TIMEOUT':e?.code==='SOURCE_SCHEMA_INVALID'?'INVALID_RESPONSE':e?.code==='SOURCE_RATE_LIMIT'?'RATE_LIMIT':'UNAVAILABLE';
  const value=missing('RANKED_SOURCE_API_FAILED',stage==='CANDIDATE_SOURCE'?'Blockscout candidate source failed; no wallet distribution was inferred.':'Pinned Ethereum balance reconciliation failed; no partial metrics were published.');
  for(const field of Object.values(value.fields)){field.reasonCode='HOLDER_'+stage+'_'+type;field.evidence=[{network:'ethereum',chainId:1,address:token.toLowerCase(),block,sourceUrl:BASE+token.toLowerCase()+'/holders',stage,status:'SOURCE_UNAVAILABLE',reasonCode:field.reasonCode}];}
  return value;
 }
}
module.exports={TOP_SIZE,parsePage,percentage,evaluate,fetchPage,readBalances,inspect};

