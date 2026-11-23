'use strict';
const keccak=require('../../../lib/keccak');
const {address,ZERO}=require('./mechanics-v8-evidence');
const EMPTY='0x'+'0'.repeat(64);
const TRANSFER=keccak(Buffer.from('Transfer(address,address,uint256)'));
const BURN_CALL=keccak(Buffer.from('burn(uint256)')).slice(0,10);
const BURN_FROM=keccak(Buffer.from('burnFrom(address,uint256)')).slice(0,10);
const HASH=/^0x[0-9a-f]{64}$/i, WORD=/^0x[0-9a-f]{64}$/i;
const RECEIPT_PROFILES=new Set(['FIXED_SUPPLY_BURNABLE_LAUNCH','FIXED_SUPPLY_OZ_BURNABLE']);
const CAPABILITIES=Object.freeze({
 FIXED_SUPPLY_BURNABLE_LAUNCH:{entryPoints:['burn(uint256)','burnFrom(address,uint256)'],rule:'BALANCE_OR_ALLOWANCE'},
 FIXED_SUPPLY_OZ_BURNABLE:{entryPoints:['burn(uint256)','burnFrom(address,uint256)'],rule:'BALANCE_OR_ALLOWANCE'},
 OWNER_RULES_BLACKLIST_FIXED_SUPPLY:{entryPoints:['burn(uint256)'],rule:'HOLDER_BALANCE'},
 MORPHO_UUPS:{entryPoints:['burn(uint256)'],rule:'HOLDER_BALANCE'},
 FIXED_SUPPLY_SELF_BURN:{entryPoints:['burn(uint256)'],rule:'HOLDER_BALANCE'},
 RECOMPILED_ROLE_BURN_MINT:{entryPoints:['burn(uint256)','burnFrom(address,uint256)'],rule:'BURNER_ROLE'},
 ROLE_MINTER_BURNER_VOTES:{entryPoints:['burn(address,uint256)'],rule:'BURNER_ROLE_CAN_BURN_HOLDER_BALANCE'},
 ALLOWANCE_MINTER_TOKEN:{entryPoints:['burn(uint256)'],rule:'MINTER_WHEN_NOT_PAUSED_OR_BLACKLISTED'},
 MINIME_CONTROLLED:{entryPoints:['destroyTokens(address,uint256)'],rule:'CONTROLLER_CAN_REDUCE_HOLDER_BALANCE'},
 FIXED_SUPPLY_POOL_SETUP:false,INITIALIZED_REWARD_LAUNCH_TOKEN:false,IMMUTABLE_POOL_BUY_TAX:false,
 FIXED_SUPPLY_NO_ADMIN:false,UNISWAP_UERC20_FIXED_SUPPLY:false,LAUNCH_TAX_DECAY_FIXED_SUPPLY:false
});
function describe({profile,proof,stamp,details}){
 const status=(type,reason)=>stamp({reason,value:null},type,'Scope check','UNKNOWN');
 const capability=Object.hasOwn(CAPABILITIES,profile)?CAPABILITIES[profile]:undefined;
 const confirmed=Boolean(proof?.sourceDigest)&&capability!==undefined;
 const burnCapability=confirmed?stamp({...proof,value:capability!==false,rule:capability?.rule||null,entryPoints:capability?.entryPoints||[],
  scope:'This covers supply-reducing code in the reviewed current runtime and does not establish a burn execution or an irrecoverable address balance.'},
  'BURN_CAPABILITY','Reviewed supply-reducing execution paths','VERIFIED'):
  status('BURN_CAPABILITY','No reviewed supply-reducing path was established.');
 const observed=details.observations||[];
 const who=observed.filter(x=>x.method==='hasRole'&&x.role==='BURNER_ROLE'&&x.value===true).map(x=>x.member);
 const burnAuthorization=confirmed&&profile==='ROLE_MINTER_BURNER_VOTES'&&who.length?
  stamp({...proof,value:[...new Set(who)],rule:'BURNER_ROLE',scope:'Observed authorized members. Other role members were not fully enumerated.'},
   'BURN_AUTHORIZATION','Pinned hasRole() under a reviewed burn gate','VERIFIED'):
  status('BURN_AUTHORIZATION','Current executable configuration was not established.');
 const buybackConfiguration=confirmed&&profile==='LAUNCH_TAX_DECAY_FIXED_SUPPLY'?
  stamp({...proof,value:false,scope:'The reviewed token sells accumulated fees for ETH and forwards it to the fee wallet. External wallet activity is separate.'},
   'BUYBACK_CONFIGURATION','Reviewed token fee disposal path','VERIFIED'):
  status('BUYBACK_CONFIGURATION','No reviewed allocation and spend path for fee-funded purchases.');
 return {burnCapability,burnAuthorization,buybackConfiguration,
  burnExecution:status('BURN_EXECUTION','No bound transaction receipt was inspected.'),
  irrecoverableBalance:status('IRRECOVERABLE_BALANCE','A dead-address balance is custody evidence and does not prove key control or total-supply change.'),
  buybackExecution:status('BUYBACK_EXECUTION','No proof connects the buyer, protocol funding, execution and destination.')};
}
function verifiedBurnReceipt({token,proof,transaction,receipt,canonicalHash,stamp}={}){
 if(!address(token)||!RECEIPT_PROFILES.has(proof?.profile)||proof.verificationStatus!=='VERIFIED'||proof.address!==token||
  proof.implementation!==token||proof.block!==receipt?.blockNumber||!proof.sourceDigest||!HASH.test(canonicalHash||'')||
  receipt?.blockHash!==canonicalHash||receipt.status!=='0x1'||address(receipt.to)!==token||
  !HASH.test(transaction?.hash||'')||transaction.hash!==receipt.transactionHash||transaction.blockHash!==canonicalHash||
  transaction.blockNumber!==receipt.blockNumber||address(transaction.to)!==token||
  address(transaction.from)!==address(receipt.from)||!Array.isArray(receipt.logs)||receipt.logs.length>128)return null;
 const input=transaction.input;
 if(typeof input!=='string'||!/^0x[0-9a-f]+$/i.test(input))return null;
 const sig=input.slice(0,10),data=input.slice(10);
 let amount,from;
 if(sig===BURN_CALL&&data.length===64){from=address(transaction.from);amount=BigInt('0x'+data);}
 if(sig===BURN_FROM&&data.length===128&&/^0{24}/.test(data)){from=address('0x'+data.slice(24,64));amount=BigInt('0x'+data.slice(64));}
 if(!amount||!from||from===ZERO)return null;
 const fromTopic='0x'+from.slice(2).padStart(64,'0');
 const events=receipt.logs.filter(l=>address(l.address)===token&&l.removed!==true&&l.blockHash===canonicalHash&&l.transactionHash===transaction.hash&&
  l.topics?.length===3&&l.topics[0]===TRANSFER&&l.topics[1]===fromTopic&&l.topics[2]===EMPTY&&WORD.test(l.data||'')&&BigInt(l.data)===amount);
 if(events.length!==1)return null;
 return stamp({value:amount.toString(),effect:'SUPPLY_REDUCTION',from,transactionHash:transaction.hash,blockHash:canonicalHash,
  contractAddress:token,logIndex:events[0].logIndex,sourceDigest:proof.sourceDigest,sourceReference:proof.sourceUrl||null},
  'BURN_EXECUTION','Exact reviewed burn method and receipt Transfer-to-zero event','VERIFIED');
}
module.exports={describe,verifiedBurnReceipt,TRANSFER};
