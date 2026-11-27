'use strict';
/**
 * Contract-state Next Unlock for reviewed vesting contracts (ONCHAIN_VERIFIED schedule).
 * Scheduled release only: never proof that the release executed, and never inferred from transfers,
 * holder balances or emissions. Every value is read from the vesting contract at one pinned block and
 * must bind to the canonical token (UNI() == token) on the expected chain.
 */
const keccak=require('../../../lib/keccak');
const records=require('../data/onchain-vesting.json');
const SEL=s=>keccak(s).slice(0,10);
const word=a=>a.replace(/^0x/,'').toLowerCase().padStart(64,'0');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const num=h=>typeof h==='string'&&/^0x[0-9a-f]{1,64}$/i.test(h)?BigInt(h):null;
const addr=h=>typeof h==='string'&&/^0x0{24}[0-9a-f]{40}$/i.test(h)?'0x'+h.slice(26).toLowerCase():null;
const unknown=(reasonCode,reason)=>({dataState:'NOT_VERIFIED',value:null,reasonCode,reason,evidence:[]});
function addMonthsUTC(seconds,months){const d=new Date(seconds*1000),t=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months,d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds());return Math.floor(t/1000);}
function decimal(raw,decimals){const s=raw.toString().padStart(decimals+1,'0'),w=s.slice(0,s.length-decimals),f=s.slice(s.length-decimals).replace(/0+$/,'');return f?w+'.'+f:w;}
async function inspect(token,{rpc=require('./eth').rpc,now=Date.now(),chainId=1}={}){
 if(!ADDRESS.test(token||''))return unknown('INVALID_TOKEN','Invalid token address.');
 const rec=records.find(r=>r.chainId===chainId&&r.token===token.toLowerCase());
 if(!rec)return unknown('NO_ONCHAIN_VESTING_RECORD','No reviewed vesting contract is registered for this exact token.');
 try{
  if(num(await rpc('eth_chainId',[]))!==BigInt(chainId))return unknown('CHAIN_ID_MISMATCH','RPC chain id differs from the registered chain.');
  const block=await rpc('eth_blockNumber',[]);
  const call=(to,data)=>rpc('eth_call',[{to,data},block]);
  const v=rec.vestingContract;
  const code=await rpc('eth_getCode',[v,block]);
  if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code))return unknown('VESTING_CONTRACT_HAS_NO_CODE','The registered vesting address has no contract code.');
  const [tokenRet,ownerRet,recipientRet,amountRet,lastRet,supplyRet,decimalsRet,blockInfo]=await Promise.all([
   call(v,SEL('UNI()')),call(v,SEL('owner()')),call(v,SEL('recipient()')),call(v,SEL('quarterlyVestingAmount()')),call(v,SEL('lastUnlockTimestamp()')),
   call(rec.token,SEL('totalSupply()')),call(rec.token,SEL('decimals()')),rpc('eth_getBlockByNumber',[block,false])]);
  if(addr(tokenRet)!==rec.token)return unknown('VESTING_TOKEN_MISMATCH','The vesting contract is not bound to this canonical token.');
  const owner=addr(ownerRet),recipient=addr(recipientRet),quarterly=num(amountRet),last=num(lastRet),supply=num(supplyRet),decimals=num(decimalsRet);
  if(!owner||!recipient||quarterly===null||quarterly<=0n||last===null||!supply||decimals===null||decimals>36n)return unknown('VESTING_STATE_UNREADABLE','Vesting getters returned malformed data.');
  const [allowanceRet,balanceRet]=await Promise.all([call(rec.token,SEL('allowance(address,address)')+word(owner)+word(v)),call(rec.token,SEL('balanceOf(address)')+word(owner))]);
  const allowance=num(allowanceRet),balance=num(balanceRet);
  if(allowance===null||balance===null)return unknown('FUNDING_UNREADABLE','Owner allowance or balance could not be read.');
  const lastSec=Number(last),blockTs=blockInfo&&num(blockInfo.timestamp);
  if(!Number.isSafeInteger(lastSec)||lastSec<1420070400||lastSec>5680000000||blockTs===null)return unknown('VESTING_STATE_UNREADABLE','Unlock timestamp out of range.');
  if(new Date(lastSec*1000).getUTCDate()>28)return unknown('UNSUPPORTED_CALENDAR_ANCHOR','Month arithmetic is only verified for anchors on days 1-28.');
  // Contract rule (verified source): a quarter is claimable once diffMonths(lastUnlockTimestamp, now) >= 3.
  const nextSec=addMonthsUTC(lastSec,3);
  if(Number(blockTs)>=nextSec)return unknown('RELEASE_ALREADY_CLAIMABLE','A quarter is already claimable; the next scheduled release is not a future event.');
  if(nextSec*1000<=now)return unknown('NOT_A_FUTURE_EVENT','Computed release is not in the future.');
  const payable=allowance<quarterly?0n:quarterly;
  if(payable===0n||balance<payable)return unknown('RELEASE_NOT_FUNDED','Owner allowance/balance does not cover the next quarterly release.');
  const date=new Date(nextSec*1000).toISOString().replace('.000Z','Z');
  const bp=(payable*10000n)/supply;
  return {dataState:'DATA_FOUND',value:date,source:'Uniswap UNIVesting contract state (Ethereum)',status:'ONCHAIN_VERIFIED',
   evidence:[{chainId,network:'ethereum',token:rec.token,vestingContract:v,block,blockTimestamp:Number(blockTs),
    sourceUrl:rec.sourceUrl,deploymentUrl:rec.deploymentUrl,reviewedAt:rec.reviewedAt,eventAmount:decimal(payable,Number(decimals)),
    percentOfTotalSupply:Number(bp)/100,allocationCategory:rec.allocationCategory,owner,recipient,
    remainingApprovedAllowance:decimal(allowance,Number(decimals)),lastUnlockTimestamp:lastSec,
    evidenceType:'ON_CHAIN_CONTRACT_STATE + OFFICIAL_GOVERNANCE_RECORD',
    scope:'Scheduled quarterly release from the Uniswap Governance Timelock to the recipient; claimable by anyone via withdraw(). Not proof the release executed. The owner (Timelock) can cancel by revoking the allowance or change the amount via updateVestingAmount.'}]};
 }catch(e){return unknown('LOOKUP_FAILED','On-chain vesting lookup failed: '+String(e.code||e.name||'error'));}
}
module.exports={inspect,addMonthsUTC,decimal};
