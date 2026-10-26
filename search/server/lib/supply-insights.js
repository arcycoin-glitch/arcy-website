'use strict';
// Four supply research metrics for the existing SECOND-PAGE Search card.
// A wallet's 0xdead/zero holdings are custody observations, NOT burned supply.
// Missing full-coverage lock evidence never becomes an assumed zero or subtotal.
const {chain}=require('./chains');
const {withTimeout}=require('./timeout');
const {ADDRESS}=require('./eth');
const DATE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const EMPTY='NOT_VERIFIED';
function unknown(network,reason,reasonCode='INSUFFICIENT_EVIDENCE'){
 const cfg=chain(network);
 return {value:null,status:EMPTY,dataState:EMPTY,source:null,evidence:[],
  reason,reasonCode,chainId:cfg.chainId,network:cfg.id};
}
function found(network,address,value,source,proof,status='SOURCE_REPORTED'){
 const cfg=chain(network);
 if(!ADDRESS.test(address)||typeof source!=='string'||!source||!proof||
  value===null||value===undefined)throw Error('Supply provenance required');
 return {value,source,status,dataState:'DATA_FOUND',network:cfg.id,chainId:cfg.chainId,
  evidence:[{chainId:cfg.chainId,network:cfg.id,address,...proof}]};
}
function baseline(network){
 return {
  lockedSupply:unknown(network,'Complete, verified vesting and escrow coverage is unavailable. A detected lock or pool lock is not necessarily the complete token locked supply.','LOCKED_SUPPLY_COVERAGE_INCOMPLETE'),
  unlockedSupply:unknown(network,'No reconciled full lock ledger. Total supply minus a partial lock sample is not verified unlocked supply.','UNLOCKED_SUPPLY_COVERAGE_INCOMPLETE'),
  verifiedBurned:unknown(network,'No verified lifetime supply-reducing burn accounting. Balances at 0x0 and 0xdead cannot establish historical burned supply.','BURN_HISTORY_NOT_ESTABLISHED'),
  nextUnlock:unknown(network,'No exact-contract, future source-reported unlock date has been verified. This does not establish that no future unlock exists.','NO_VERIFIED_NEXT_UNLOCK')
 };
}
function eventTime(text,now=Date.now()){
 if(typeof text!=='string'||!DATE.test(text))return null;
 const ms=Date.parse(text);
 if(!Number.isFinite(ms))return null;
 // Reject JS Date rollovers (for example February 31), even if Date.parse accepts them.
 const canonical=text.endsWith('.000Z')?text:text.replace(/Z$/,'.000Z');
 if(new Date(ms).toISOString()!==canonical)return null;
 return ms>now&&ms<now+100*365.25*86400000?ms:null;
}
function sourceSchedule(network,address,record,source,scope){
 if(!record||record.dataState!=='DATA_FOUND'||!eventTime(record.value?.date))return null;
 const amount=record.value?.amount;
 const numberOK=(typeof amount==='string'&&/^\d+(?:\.\d+)?$/.test(amount)||typeof amount==='number'&&Number.isFinite(amount))&&Number(amount)>0;
 if(!numberOK||!Array.isArray(record.evidence)||record.evidence.length===0)return null;
 const proof={method:'contract-exact source-reported future unlock',date:record.value.date,eventAmount:String(amount),
  scope,sourceType:record.status,sourceEvidence:record.evidence.slice(0,3)};
 const link=record.evidence.find(x=>/^https:\/\//.test(x?.sourceUrl||x?.url||''));
 if(link)proof.sourceUrl=link.sourceUrl||link.url;
 return found(network,address,record.value.date,source,proof,'SOURCE_REPORTED');
}
async function arcNext(base){
 // The legacy adapter uses contract-selected metadata, funded matching vesting
 // getters and exact token address checks. We do not promote these to pinned
 // block global schedules: an incomplete vesting address list is source-scoped.
 const records=require('../../../lib/unlock-sources');
 const options=await Promise.allSettled([
  withTimeout(records.vesting(base.address),3500,'Arc source vesting timeout'),
  withTimeout(records.documentation(base.address),3500,'Arc metadata timeout')
 ]);
 const verified=options.map((o,i)=>o.status==='fulfilled'?sourceSchedule('arc',base.address,o.value,
  i===0?'Arc contract-linked funded vesting report':'Arc contract-selected project schedule',
  i===0?'Funded next installment in a metadata-linked vesting contract; this is not proof of complete vesting coverage or arbitrary release restrictions.':
    'Issuer-reported schedule selected through exact token contract metadata; enforcement and all other unlocks are not proven.') : null).filter(Boolean);
 verified.sort((a,b)=>Date.parse(a.value)-Date.parse(b.value));
 return verified[0]||baseline('arc').nextUnlock;
}
async function arcNonburnableZero(base){
 // Prove zero only for a reviewed EXACT source whose immutable implementation
 // explicitly cannot reduce ERC-20 totalSupply, not for arbitrary transfers to
 // zero/dead addresses or for contract owners claiming no burn.
 if(!ADDRESS.test(base.address)||base.chainId!==5042||base.network!=='arc'||
  !/^0x[0-9a-f]+$/i.test(base.block||'')||
  !/^(0|[1-9]\d*)$/.test(base.totalSupplyRaw||''))return baseline('arc').verifiedBurned;
 const rpc=require('./arc-rpc');
 const code=await rpc.rpc('eth_getCode',[base.address,base.block],{timeoutMs:1800});
 if(!/^0x(?:[0-9a-f]{2})+$/i.test(code||''))return baseline('arc').verifiedBurned;
 const runtime=require('../../../lib/mechanics-runtime');
 if(!runtime.nonDelegating(code))return baseline('arc').verifiedBurned;
 const review=await require('../../../lib/verified-source').lookup(base.address,code);
 if(review.dataState!=='DATA_FOUND'||review.address!==base.address||
  !['match','exact_match'].includes(review.runtimeMatch)||
  review.profile?.id!=='FIXED_SUPPLY_CAPPED_ERC20')return baseline('arc').verifiedBurned;
 return found('arc',base.address,'0','Arc pinned RPC + bytecode-matched reviewed implementation',
  {block:base.block,sourceDigest:review.sourceDigest,profile:review.profile.id,method:'eth_getCode() + totalSupply() + reviewed immutable supply-reduction logic',
   scope:'The exact reviewed implementation has no supply-decreasing mechanism. Zero applies to lifetime supply-reducing token burns, NOT dead-address custody or buyback execution.'},'ONCHAIN_VERIFIED');
}
async function inspect({network,base}){
 if(!['arc','ethereum','robinhood'].includes(network)||
  !ADDRESS.test(base?.address||'')||base.network!==network||
  base.chainId!==chain(network).chainId)throw Error('Supply research token identity mismatch');
 const result=baseline(network);
 if(network==='arc'){
  const [next,burn]=await Promise.allSettled([
   withTimeout(arcNext(base),3900,'Arc unlock lookup deadline'),
   withTimeout(arcNonburnableZero(base),3900,'Arc burn proof deadline')
  ]);
  if(next.status==='fulfilled')result.nextUnlock=next.value;
  if(burn.status==='fulfilled')result.verifiedBurned=burn.value;
 }else if(network==='ethereum'){
  const reviewed=require('./unlocks').inspect(base.address);
  if(reviewed?.dataState==='DATA_FOUND'&&eventTime(reviewed.value)&&
   Array.isArray(reviewed.evidence)&&reviewed.evidence.length){
   const proof=reviewed.evidence[0];
   const amount=proof.eventAmount;
   if(typeof amount==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)&&Number(amount)>0)
    result.nextUnlock=found(network,base.address,reviewed.value,reviewed.source||'Reviewed source-published unlock schedule',
     {sourceUrl:proof.sourceUrl,reviewedAt:proof.reviewedAt,eventAmount:amount,
      scope:'Exact Ethereum token-contract match; schedule source-reported, not proof of global vesting completeness or on-chain execution.'},'SOURCE_REPORTED');
  }
 }
 result.nextUnlock=require('./unlock-windows').attach(result.nextUnlock,{network,address:base.address});
 return result;
}
module.exports={inspect,baseline,unknown,found,eventTime,sourceSchedule,arcNext,arcNonburnableZero};
