'use strict';
/**
 * Additive, display-only projection of a verified scheduled unlock for the Supply card's expandable research details.
 * It never feeds the four schema metrics. Everything is re-validated against the reviewed on-chain registry; free text
 * from evidence is NOT forwarded, caveats are fixed server-side. A schedule is not an executed transaction.
 */
const records=require('../data/onchain-vesting.json');
const ADDRESS=/^0x[0-9a-f]{40}$/;
const CAVEAT='Scheduled release only - not an executed transaction. The owner (Uniswap Governance Timelock) can revoke the allowance or change the amount before the release; once the date passes anyone can trigger withdraw() and the tokens go to the recipient.';
function project(field,context,now=Date.now()){
 try{
  if(!field||field.dataState!=='DATA_FOUND'||field.status!=='ONCHAIN_VERIFIED'||typeof field.value!=='string')return null;
  const e=field.evidence?.[0];
  if(!e||!context||typeof context.address!=='string')return null;
  const token=context.address.toLowerCase();
  const rec=records.find(r=>r.chainId===1&&r.token===token);
  if(!rec||e.chainId!==1||e.token!==token||e.vestingContract!==rec.vestingContract)return null;
  if(!/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(field.value)||Date.parse(field.value)<=now)return null;
  if(typeof e.eventAmount!=='string'||!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(e.eventAmount)||!/[1-9]/.test(e.eventAmount))return null;
  if(typeof e.percentOfTotalSupply!=='number'||!(e.percentOfTotalSupply>0&&e.percentOfTotalSupply<=100))return null;
  if(!ADDRESS.test(String(e.recipient||''))||!ADDRESS.test(String(e.owner||''))||!/^0x[0-9a-f]+$/i.test(e.block||''))return null;
  return {kind:'SCHEDULED_UNLOCK',executed:false,scheduleStatus:'SCHEDULED',verification:'ONCHAIN_VERIFIED_SCHEDULE',
   chainId:1,network:'ethereum',token,symbol:rec.symbol,vestingContract:rec.vestingContract,date:field.value,amount:e.eventAmount,
   percentOfTotalSupply:e.percentOfTotalSupply,allocationCategory:rec.allocationCategory,
   source:'Uniswap UNIVesting contract state (Ethereum, pinned block) + governance proposal 93',sourceUrl:rec.sourceUrl,
   recipient:e.recipient,owner:e.owner,block:e.block,revocable:true,caveat:CAVEAT};
 }catch{return null;}
}
module.exports={project,CAVEAT};
