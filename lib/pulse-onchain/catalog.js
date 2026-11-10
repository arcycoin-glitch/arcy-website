'use strict';
// Pulse V2 event catalogue. Every topic is derived from its canonical signature with the repo's own keccak
// (no hand-typed hashes). A log is accepted only when its topic count AND data length match a declared layout,
// so an unrelated event that happens to share topic0 (e.g. ERC-721 Transfer) cannot be decoded as a token event.
const keccak=require('../keccak');
const topic=signature=>keccak(Buffer.from(signature)).toLowerCase();
const ZERO_ADDRESS='0x0000000000000000000000000000000000000000';
const ZERO_TOPIC='0x'+'0'.repeat(64);
const IMPLEMENTATION_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const DEFAULT_ADMIN_ROLE=ZERO_TOPIC;

const isWord=w=>typeof w==='string'&&/^0x[0-9a-f]{64}$/i.test(w);
function address(word){
 if(!isWord(word)||!/^0x0{24}/.test(word))throw Error('NOT_AN_ADDRESS_WORD');
 return '0x'+word.slice(26).toLowerCase();
}
const words=data=>data.slice(2).match(/.{64}/g)?.map(w=>'0x'+w)||[];
const uint=word=>BigInt(word);
const int=(word,bits)=>BigInt.asIntN(bits,BigInt(word));

// layout: [topicCount, dataWords]. Several layouts are listed where deployed contracts differ in `indexed` usage.
const EVENTS=[
 {key:'OWNERSHIP_TRANSFERRED',signature:'OwnershipTransferred(address,address)',scope:'token',category:'OWNERSHIP_CHANGE',layouts:[[3,0],[1,2]],
  decode:(t,d)=>{const [previousOwner,newOwner]=t.length===3?[address(t[1]),address(t[2])]:[address(d[0]),address(d[1])];return {previousOwner,newOwner,renounced:newOwner===ZERO_ADDRESS};}},
 {key:'OWNERSHIP_TRANSFER_STARTED',signature:'OwnershipTransferStarted(address,address)',scope:'token',category:'OWNERSHIP_CHANGE',layouts:[[3,0]],
  decode:t=>({previousOwner:address(t[1]),pendingOwner:address(t[2]),pending:true})},
 {key:'UPGRADED',signature:'Upgraded(address)',scope:'token',category:'CONTRACT_UPGRADE',layouts:[[2,0],[1,1]],
  decode:(t,d)=>({implementation:address(t.length===2?t[1]:d[0])})},
 {key:'BEACON_UPGRADED',signature:'BeaconUpgraded(address)',scope:'token',category:'CONTRACT_UPGRADE',layouts:[[2,0]],
  decode:t=>({beacon:address(t[1])})},
 {key:'ADMIN_CHANGED',signature:'AdminChanged(address,address)',scope:'token',category:'ADMIN_CHANGE',layouts:[[1,2]],
  decode:(t,d)=>({previousAdmin:address(d[0]),newAdmin:address(d[1])})},
 {key:'ROLE_GRANTED',signature:'RoleGranted(bytes32,address,address)',scope:'token',category:'ROLE_CHANGE',layouts:[[4,0]],
  decode:t=>({role:t[1].toLowerCase(),account:address(t[2]),sender:address(t[3]),granted:true,defaultAdminRole:t[1].toLowerCase()===DEFAULT_ADMIN_ROLE})},
 {key:'ROLE_REVOKED',signature:'RoleRevoked(bytes32,address,address)',scope:'token',category:'ROLE_CHANGE',layouts:[[4,0]],
  decode:t=>({role:t[1].toLowerCase(),account:address(t[2]),sender:address(t[3]),granted:false,defaultAdminRole:t[1].toLowerCase()===DEFAULT_ADMIN_ROLE})},
 {key:'PAUSED',signature:'Paused(address)',scope:'token',category:'PAUSE_STATE',layouts:[[1,1]],decode:(t,d)=>({paused:true,account:address(d[0])})},
 {key:'UNPAUSED',signature:'Unpaused(address)',scope:'token',category:'PAUSE_STATE',layouts:[[1,1]],decode:(t,d)=>({paused:false,account:address(d[0])})},
 // Legacy argument-less pause events (e.g. Tether-style tokens).
 {key:'PAUSE_LEGACY',signature:'Pause()',scope:'token',category:'PAUSE_STATE',layouts:[[1,0]],decode:()=>({paused:true})},
 {key:'UNPAUSE_LEGACY',signature:'Unpause()',scope:'token',category:'PAUSE_STATE',layouts:[[1,0]],decode:()=>({paused:false})},
 // Supply. ERC-20 mint/burn is a Transfer whose from/to is the zero address; queried with that topic filter only.
 {key:'TRANSFER',signature:'Transfer(address,address,uint256)',scope:'supply',category:'SUPPLY_CHANGE',layouts:[[3,1]],
  decode:(t,d)=>{const from=address(t[1]),to=address(t[2]);if((from===ZERO_ADDRESS)===(to===ZERO_ADDRESS))return null;return {direction:from===ZERO_ADDRESS?'MINT':'BURN',account:from===ZERO_ADDRESS?to:from,amountRaw:uint(d[0]).toString()};}},
 // Legacy issuer events that change totalSupply without a zero-address Transfer.
 {key:'ISSUE_LEGACY',signature:'Issue(uint256)',scope:'token',category:'SUPPLY_CHANGE',layouts:[[1,1]],decode:(t,d)=>({direction:'MINT',account:null,amountRaw:uint(d[0]).toString()})},
 {key:'REDEEM_LEGACY',signature:'Redeem(uint256)',scope:'token',category:'SUPPLY_CHANGE',layouts:[[1,1]],decode:(t,d)=>({direction:'BURN',account:null,amountRaw:uint(d[0]).toString()})},
 // Pool creation at reviewed factory / pool-manager deployments, filtered to watched tokens by indexed topic.
 {key:'V2_PAIR_CREATED',signature:'PairCreated(address,address,address,uint256)',scope:'factory',architecture:'v2',category:'NEW_POOL',layouts:[[3,2]],tokenTopics:[1,2],
  decode:(t,d)=>({architecture:'V2_CONSTANT_PRODUCT',token0:address(t[1]),token1:address(t[2]),pool:address(d[0])})},
 {key:'V3_POOL_CREATED',signature:'PoolCreated(address,address,uint24,int24,address)',scope:'factory',architecture:'v3',category:'NEW_POOL',layouts:[[4,2]],tokenTopics:[1,2],
  decode:(t,d)=>({architecture:'V3_CONCENTRATED',token0:address(t[1]),token1:address(t[2]),feePips:Number(uint(t[3])),tickSpacing:Number(int(d[0],24)),pool:address(d[1])})},
 {key:'V4_INITIALIZE',signature:'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)',scope:'factory',architecture:'v4',category:'NEW_POOL',layouts:[[4,5]],tokenTopics:[2,3],
  decode:(t,d)=>({architecture:'V4_CONCENTRATED',poolId:t[1].toLowerCase(),token0:address(t[2]),token1:address(t[3]),feePips:Number(uint(d[0])),tickSpacing:Number(int(d[1],24)),hooks:address(d[2])})}
].map(e=>Object.freeze({...e,topic0:topic(e.signature)}));

const BY_TOPIC=new Map(EVENTS.map(e=>[e.topic0,e]));
const SELECTORS=Object.freeze({owner:topic('owner()').slice(0,10),totalSupply:topic('totalSupply()').slice(0,10),decimals:topic('decimals()').slice(0,10),paused:topic('paused()').slice(0,10)});

// Strict structural validation + decode. Returns {event,details} or {rejected:<reason>}.
function decode(log){
 if(!log||typeof log!=='object')return {rejected:'MALFORMED_LOG'};
 if(log.removed===true)return {rejected:'REMOVED_BY_REORG'};
 const topics=log.topics;
 if(!Array.isArray(topics)||!topics.length||!topics.every(isWord)||typeof log.data!=='string'||!/^0x(?:[0-9a-f]{64})*$/i.test(log.data)||
   !/^0x[0-9a-f]{40}$/i.test(log.address||'')||!/^0x[0-9a-f]{64}$/i.test(log.blockHash||'')||!/^0x[0-9a-f]{64}$/i.test(log.transactionHash||'')||
   !/^0x[0-9a-f]+$/i.test(log.blockNumber||'')||!/^0x[0-9a-f]+$/i.test(log.logIndex||''))return {rejected:'MALFORMED_LOG'};
 const event=BY_TOPIC.get(topics[0].toLowerCase());
 if(!event)return {rejected:'UNKNOWN_TOPIC'};
 const data=words(log.data);
 if(!event.layouts.some(([t,d])=>t===topics.length&&d===data.length))return {rejected:'LAYOUT_MISMATCH'};
 let details;
 try{details=event.decode(topics,data);}catch{return {rejected:'DECODE_FAILED'};}
 if(!details)return {rejected:'NOT_A_SUPPLY_EVENT'};
 return {event,details};
}
module.exports={EVENTS,BY_TOPIC,SELECTORS,topic,decode,address,ZERO_ADDRESS,ZERO_TOPIC,IMPLEMENTATION_SLOT,DEFAULT_ADMIN_ROLE};
