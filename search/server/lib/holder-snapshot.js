'use strict';
const {ADDRESS, uint}=require('./eth');
const {found,unknown,card}=require('./evidence');
const MAX_HOLDERS=60;
const MAX_PAGES=4;
const MAX_PAGE_ITEMS=50;
const CURSOR_KEYS=new Set(['address_hash','value','items_count']);
const keys=['holderCount','largestWalletPct','top10Pct','top20Pct'];
const empty=(reason,reasonCode='HOLDER_SNAPSHOT_INCOMPLETE')=>card(
 Object.fromEntries(keys.map(k=>[k,unknown(reason,reasonCode)])),
 'Four metrics remain unverified until all current balances are reconciled at one Ethereum block.'
);
function addressFromItem(item){
 const candidate=typeof item?.address==='string'?item.address:item?.address?.hash||item?.address_hash;
 return ADDRESS.test(candidate||'')?candidate.toLowerCase():null;
}
function cursor(next){
 if(next===null)return null;
 if(!next||typeof next!=='object'||Array.isArray(next))throw Error('Malformed holder pagination cursor');
 const obj={};
 for(const [k,v] of Object.entries(next)){
  if(!CURSOR_KEYS.has(k))throw Error('Unexpected holder pagination key');
  if(k==='address_hash'){
   if(!ADDRESS.test(v||''))throw Error('Invalid pagination address');
   obj[k]=v;
  }else if(k==='value'){
   if(typeof v!=='string'||!/^\d+$/.test(v))throw Error('Invalid pagination balance');
   obj[k]=v;
  }else if(k==='items_count'){
   if(!Number.isInteger(v)||v<0||v>MAX_HOLDERS)throw Error('Invalid pagination item count');
   obj[k]=v;
  }
 }
 if(!Object.keys(obj).length)throw Error('Empty pagination cursor');
 return obj;
}
async function paginate(fetchPage,expected){
 if(!Number.isSafeInteger(expected)||expected<1||expected>MAX_HOLDERS)throw Error('Holder count exceeds safe snapshot budget');
 const addresses=[],seen=new Set(),cursors=new Set();
 let next=null,complete=false;
 for(let page=0;page<MAX_PAGES;page++){
  const result=await fetchPage(next);
  if(!result||!Array.isArray(result.items)||result.items.length>MAX_PAGE_ITEMS)throw Error('Malformed holder page');
  if(!result.items.length&&result.next_page_params)throw Error('Empty holder page with continuation');
  for(const item of result.items){
   const address=addressFromItem(item);
   if(!address||seen.has(address))throw Error('Invalid or duplicate indexed holder address');
   seen.add(address);addresses.push(address);
   if(addresses.length>expected)throw Error('Explorer holder count inconsistent with pages');
  }
  next=cursor(result.next_page_params===undefined?null:result.next_page_params);
  if(next===null){complete=true;break}
  const serial=JSON.stringify(next);
  if(cursors.has(serial))throw Error('Repeated holder pagination cursor');
  cursors.add(serial);
 }
 if(!complete||addresses.length!==expected)throw Error('Explorer pagination incomplete relative to reported holder count');
 return addresses;
}
function percentage(balance,total){
 if(total<=0n||balance<0n||balance>total)throw Error('Invalid concentration operands');
 const units=(balance*1000000n)/total;
 return Number(units)/10000;
}
function reconcile(addresses,balances,expected,totalRaw,contract,block){
 if(!ADDRESS.test(contract||'')||!/^0x[0-9a-f]+$/i.test(block||''))throw Error('Invalid snapshot identity');
 if(!Array.isArray(addresses)||!Array.isArray(balances)||addresses.length!==expected||balances.length!==expected)throw Error('Incomplete pinned balance coverage');
 if(new Set(addresses).size!==expected||addresses.some(a=>!ADDRESS.test(a)))throw Error('Invalid holder address inventory');
 const total=BigInt(totalRaw);
 if(total<=0n)throw Error('No positive total supply');
 if(balances.some(b=>typeof b!=='bigint'||b<=0n||b>total))throw Error('Nonpositive or invalid indexed holder balance');
 const sum=balances.reduce((acc,b)=>acc+b,0n);
 if(sum!==total)throw Error('Indexed balance sum does not match pinned totalSupply');
 const ordered=balances.slice().sort((a,b)=>a>b?-1:a<b?1:0);
 const top=n=>ordered.slice(0,n).reduce((acc,b)=>acc+b,0n);
 const source='Ethereum RPC / Blockscout';
 const ev=[{
  source:'Ethereum RPC + Blockscout',
  contractAddress:contract.toLowerCase(),block,
  pageCount:'complete',holderCount:expected,
  totalSupplyRaw:total.toString(),sumAllHolderBalancesRaw:sum.toString(),
  method:'balanceOf(address) at pinned block + complete explorer candidate enumeration',
  scope:'Includes all enumerated positive holders, including custodial / burn / contract addresses. On-chain balances reconcile exactly to totalSupply.'
 }];
 return card({
  holderCount:found(expected,source,ev,'ONCHAIN_RECONCILED'),
  largestWalletPct:found(percentage(ordered[0],total),source,ev,'ONCHAIN_RECONCILED'),
  top10Pct:found(percentage(top(10),total),source,ev,'ONCHAIN_RECONCILED'),
  top20Pct:found(percentage(top(20),total),source,ev,'ONCHAIN_RECONCILED')
 },'Fully enumerated positive wallets and balances reconciled against pinned-block total supply.');
}
async function snapshot({contract,block,totalRaw,count,fetchPage,readBalance}){
 if(!ADDRESS.test(contract||''))return empty('Invalid Ethereum contract address.','INVALID_ADDRESS');
 if(!/^0x[0-9a-f]+$/i.test(block||''))return empty('Invalid pinned block.','INVALID_BLOCK');
 if(!Number.isSafeInteger(count)||count<=0)return empty('Explorer has no usable positive holder count.','HOLDER_COUNT_NOT_VERIFIED');
 if(count>MAX_HOLDERS)return empty('Holder count exceeds bounded complete-enumeration budget.','SNAPSHOT_TOO_LARGE');
 try{
  const addresses=await paginate(fetchPage,count);
  const balances=new Array(addresses.length);
  // Bounded concurrency protects public RPC providers and function budgets.
  let index=0;
  async function worker(){
   for(;;){
    const i=index++;
    if(i>=addresses.length)return;
    const result=await readBalance(addresses[i],block);
    balances[i]=typeof result==='bigint'?result:uint(result);
   }
  }
  await Promise.all(Array.from({length:Math.min(5,addresses.length)},()=>worker()));
  return reconcile(addresses,balances,count,totalRaw,contract,block);
 }catch(err){
  return empty('Complete on-chain holder reconciliation failed: '+String(err.message||'Unknown error').slice(0,105),'HOLDER_RECONCILIATION_FAILED');
 }
}
module.exports={MAX_HOLDERS,MAX_PAGES,addressFromItem,cursor,paginate,percentage,reconcile,snapshot,empty};
