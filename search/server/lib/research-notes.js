'use strict';
// Interpret only established field states. No risk scores or inferred ownership.
function notes(cardId,fields){
 const known=key=>fields[key]?.dataState==='DATA_FOUND';
 const out=[];
 if(cardId==='holders')out.push('Address balances do not establish beneficial ownership. Candidate-relative ranks are not an exhaustive holder census; unknown roles remain UNKNOWN. Historical COMPLETE snapshots describe their original block only.');
 if(cardId==='liquidity')out.push('Reported pool liquidity and returned pool counts do not guarantee exit capacity. LP custody, lock duration and withdrawal authority require separate exact-pool evidence.');
 if(cardId==='supply')out.push('Locked and unlocked totals require complete contract-matched vesting coverage. Current zero/dead-address balances do not establish an official buyback, burn event, permanent destruction or lifetime burned supply. A funded or issuer-published next event does not prove that every unlock was identified. Exact-chain source traces are available per field.');
 if(cardId==='activity')out.push('Price, volume and valuation retain their individual provider timestamps and scopes. Market cap requires verified circulating supply; FDV is not market cap.');
 if(cardId==='mechanics'){
  if(known('ownerAdmin'))out.push('An observed owner/admin getter or registry is not a complete enumeration of privileged roles or upgrade permissions.');
  if(known('contractArchitecture'))out.push('A proxy target or runtime architecture does not by itself prove who can upgrade it.');
  if(known('mintCapability'))out.push('Mint interpretation is limited to the reviewed source/state evidence below; an interface selector alone is not proof of executable mint authority.');
  out.push('Pause, blacklist, timelock and role-administrator observations remain interface-only or UNKNOWN unless their source and pinned execution path are established. No risk rating is inferred.');
 }
 return out;
}
module.exports={notes};
