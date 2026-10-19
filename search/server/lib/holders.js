'use strict';
const {found,unknown,error,card}=require('./evidence');
const {rpc,ADDRESS,uint}=require('./eth');
const source=require('./source-request').createReader({ttlMs:10000});
const API='https://eth.blockscout.com/api/v2/tokens/';
const MAX_HOLDERS=30;
const blank=(reason,code='HOLDER_SNAPSHOT_NOT_VERIFIED')=>card(Object.fromEntries(['holderCount','largestWalletPct','top10Pct','top20Pct'].map(k=>[k,unknown(reason,code)])),'Ethereum holder snapshot; no partial concentration is represented as verified.');
function parseCount(payload){
 const v=payload?.token_holders_count??payload?.holders_count;
 if(typeof v==='number'&&Number.isSafeInteger(v)&&v>0)return v;
 if(typeof v==='string'&&/^[1-9]\d*$/.test(v)&&Number.isSafeInteger(Number(v)))return Number(v);
 return null;
}
function holders(rows){
 if(!Array.isArray(rows))return null;
 const seen=new Set(),result=[];
 for(const item of rows){
   const address=typeof item?.address==='string'?item.address:item?.address?.hash||item?.address_hash;
   if(!ADDRESS.test(address||''))return null;
   const lower=address.toLowerCase();
   if(seen.has(lower))return null;
   seen.add(lower);result.push(lower);
 }
 return result;
}
function pct(numerator,denominator){
 if(denominator<=0n||numerator<0n||numerator>denominator)throw Error('Invalid supply percentage');
 // BigInt-scaled four-decimal percentage avoids float precision loss on raw token balances.
 const scaled=(numerator*1000000n+denominator/2n)/denominator;
 return Number(scaled)/10000;
}
function calculate(addresses,balances,supply,count,block,token){
 if(!Array.isArray(addresses)||!Array.isArray(balances)||addresses.length<1||addresses.length!==balances.length||addresses.length!==count||!Number.isSafeInteger(count)||count>MAX_HOLDERS||typeof supply!=='bigint'||supply<=0n)return blank('The complete holder population was not reconciled.','INCOMPLETE_HOLDER_COVERAGE');
 if(new Set(addresses.map(a=>String(a).toLowerCase())).size!==addresses.length||addresses.some(a=>!ADDRESS.test(a))||balances.some(n=>typeof n!=='bigint'||n<=0n||n>supply))return blank('Invalid, duplicate, or zero-balance holder entries.','HOLDER_RECONCILIATION_FAILED');
 const total=balances.reduce((s,n)=>s+n,0n);
 if(total!==supply)return blank('Pinned holder balances do not sum to the contract total supply.','HOLDER_SUPPLY_RECONCILIATION_FAILED');
 const ranking=balances.slice().sort((a,b)=>a>b?-1:a<b?1:0);
 const sum=n=>ranking.slice(0,n).reduce((s,x)=>s+x,0n);
 const proof=[{source:'Ethereum RPC',token,block,method:'balanceOf()',holderCount:count,coverage:'All explorer-listed holder addresses read at the same block; positive balances sum exactly to totalSupply().' ,note:'Explorer membership is source-reported. Full-supply reconciliation makes missing positive balances detectable for conventional ERC-20s.'}];
 return card({
   holderCount:found(count,'Blockscout + Ethereum RPC',proof,'RECONCILED_SNAPSHOT'),
   largestWalletPct:found(pct(ranking[0],supply),'Ethereum RPC',proof,'RECONCILED_SNAPSHOT'),
   top10Pct:found(pct(sum(10),supply),'Ethereum RPC',proof,'RECONCILED_SNAPSHOT'),
   top20Pct:found(pct(sum(20),supply),'Ethereum RPC',proof,'RECONCILED_SNAPSHOT')
 },'All positive-balance holder candidates reconciled to supply at the pinned block; top 10/20 includes all wallets when fewer exist.');
}
async function json(url){
 return source.json(url,{maxBytes:512*1024,timeoutMs:5000,validate:body=>Boolean(body&&typeof body==='object'&&!Array.isArray(body)&&
  (url.endsWith('/counters')?parseCount(body)!==null:Array.isArray(body.items)))});
}
async function pages(address,count){
 const addresses=[],seenPages=new Set();
 let params=null;
 for(let n=0;n<MAX_HOLDERS;n++){
   const url=new URL(API+address+'/holders');
   if(params){
     if(typeof params!=='object'||Array.isArray(params))throw Error('Malformed pagination cursor');
     for(const [key,value] of Object.entries(params)){
       if(!/^[a-zA-Z0-9_]+$/.test(key)||!['string','number'].includes(typeof value))throw Error('Unsafe pagination cursor');
       url.searchParams.set(key,String(value));
     }
   }
   const page=await json(url.toString());
   const chunk=holders(page.items);
   if(!chunk||chunk.length===0)throw Error('Invalid holder page');
   addresses.push(...chunk);
   if(addresses.length>count||addresses.length>MAX_HOLDERS||new Set(addresses).size!==addresses.length)throw Error('Holder list mismatch');
   if(page.next_page_params===null||page.next_page_params===undefined){
     if(addresses.length!==count)throw Error('Explorer count differs from complete page list');
     return addresses;
   }
   if(addresses.length===count)throw Error('Unexpected pagination after complete count');
   const key=JSON.stringify(page.next_page_params);
   if(seenPages.has(key))throw Error('Repeated holder page cursor');
   seenPages.add(key);params=page.next_page_params;
 }
 throw Error('Holder page limit reached');
}
async function balancesAtBlock(token,addresses,block){
 const result=Array(addresses.length);
 const workers=Array.from({length:Math.min(6,addresses.length)},async(_,w)=>{
   for(let i=w;i<addresses.length;i+=6){
     const data='0x70a08231'+addresses[i].slice(2).padStart(64,'0');
     result[i]=uint(await rpc('eth_call',[{to:token,data},block]));
   }
 });
 await Promise.all(workers);
 return result;
}
async function inspect(address,block,rawSupply,{getCounters=json,getPages=pages,getBalances=balancesAtBlock}={}){
 if(!ADDRESS.test(address)||!/^0x[0-9a-f]+$/i.test(block||''))return blank('Invalid Ethereum token or pinned block.','INVALID_INPUT');
 let reported=null;
 try{
   const info=await getCounters(API+address.toLowerCase()+'/counters');
   const count=parseCount(info);
   if(!count)return blank('A positive explorer holder count was not established.','COUNT_NOT_VERIFIED');
   reported=found(count,'Blockscout',[{provider:'Blockscout',address,sourceUrl:API+address.toLowerCase()+'/counters',scope:'Source-reported current holder count; may not match an earlier pinned block.'}],'SOURCE_REPORTED',source.observedAt(API+address.toLowerCase()+'/counters'));
   if(count>MAX_HOLDERS){
     const sourceRank=await require('./large-holders').inspect(address.toLowerCase(),block,rawSupply,count);
     return {...card({
       holderCount:reported,
       ...sourceRank.fields
     },sourceRank.rankedEvidence
       ?'Blockscout holder addresses re-ranked using pinned Ethereum RPC balances. Candidate-list completeness remains SOURCE_REPORTED.'
       :'Blockscout-reported holder count only; ranked candidates could not be reconciled.'
     ),holderCandidates:sourceRank.holderCandidates||[]};
   }
   // Complete small-wallet census is allowed only after every indexed wallet
   // is re-read at the pinned block and balances equal the total token supply.
   const all=await getPages(address.toLowerCase(),count);
   const balances=await getBalances(address.toLowerCase(),all,block);
   const raw=uint('0x'+BigInt(rawSupply).toString(16).padStart(64,'0')); // rawSupply must be base units, not formatted supply.
   const complete=calculate(all,balances,raw,count,block,address.toLowerCase());
   if(complete.fields.holderCount?.dataState==='DATA_FOUND')return complete;
   // Keep trustworthy source-reported count when pinned whale proof fails.
   complete.fields.holderCount=reported;
   complete.description='Blockscout source-reported current holder count only; wallet distribution could not be reconciled.';
   complete.status='PARTIAL_EVIDENCE';
   return complete;
 }catch(e){
   const result=blank('Holder verification failed.','SOURCE_API_FAILED');
   result.fields.holderCount=reported||error(e,'Blockscout / Ethereum RPC');
   if(reported){
    result.status='PARTIAL_EVIDENCE';
    result.description='Blockscout source-reported current holder count; RPC wallet ranking unavailable.';
   }
   return result;
 }
}
module.exports={MAX_HOLDERS,parseCount,holders,pct,calculate,pages,balancesAtBlock,inspect,blank};

