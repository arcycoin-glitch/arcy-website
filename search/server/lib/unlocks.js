'use strict';
/**
 * Verified-identity, source-reported vesting schedule adapter.
 * No unlock dates are inferred from circulating supply, DEX movements or ERC20 events.
 * A source-linked, reviewed schedule must be supplied in data/eth-unlocks.json.
 */
const {unknown,found}=require('./evidence');
const {ADDRESS}=require('./eth');
const records=require('../data/eth-unlocks.json');
const MAX_AGE_DAYS=180;
const urlOK=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!!u.hostname&&u.username===''&&u.password===''}catch{return false}};
function nextEvent(rows,address,now=new Date()){
 if(!ADDRESS.test(address)||!Array.isArray(rows)||!(now instanceof Date)||!Number.isFinite(now.getTime()))return unknown('An eligible unlock schedule is unavailable.','INVALID_UNLOCK_INPUT');
 const matching=rows.filter(x=>x&&x.chainId===1&&typeof x.contract==='string'&&x.contract.toLowerCase()===address.toLowerCase());
 if(!matching.length)return unknown('No reviewed source-reported unlock schedule for this contract.','NO_SOURCE_REPORTED_SCHEDULE');
 const eligible=[];
 for(const row of matching){
  if(!urlOK(row.sourceUrl)||typeof row.sourceName!=='string'||!row.sourceName.trim()||typeof row.reviewedAt!=='string'||!Array.isArray(row.events))continue;
  const reviewed=new Date(row.reviewedAt);
  if(!Number.isFinite(reviewed.getTime())||reviewed.getTime()>now.getTime()||now.getTime()-reviewed.getTime()>MAX_AGE_DAYS*86400000)continue;
  for(const e of row.events){
   if(!e||typeof e.date!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(e.date))continue;
   const when=new Date(e.date);
   if(!Number.isFinite(when.getTime())||when.getTime()<=now.getTime()||when.toISOString().replace('.000Z','Z')!==e.date)continue;
   if(typeof e.amount!=='string'||!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(e.amount)||!/[1-9]/.test(e.amount))continue;
   eligible.push({event:e,when,row});
  }
 }
 eligible.sort((a,b)=>a.when-b.when);
 if(!eligible.length)return unknown('No future, recently reviewed, source-reported unlock event.','NO_VERIFIED_FUTURE_EVENT');
 const first=eligible[0];
 return found(first.event.date,'Reviewed unlock schedule',[{sourceUrl:first.row.sourceUrl,sourceName:first.row.sourceName,contract:address.toLowerCase(),chainId:1,reviewedAt:first.row.reviewedAt,eventAmount:first.event.amount,unit:first.row.amountUnit||'token',reviewType:'Curated contract-exact published schedule; event execution not confirmed.'}],'SOURCE_REPORTED');
}
const inspect=(address,now=new Date())=>nextEvent(records,address,now);
module.exports={nextEvent,inspect,urlOK};
