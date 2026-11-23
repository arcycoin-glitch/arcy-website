'use strict';
const {chain,verifyChainId}=require('./chains');
const {address,recorder}=require('./mechanics-v8-evidence');
const {SLOTS}=require('./mechanics-deep');
const HASH=/^0x[0-9a-f]{64}$/i, HEIGHT=/^0x(?:0|[1-9a-f][0-9a-f]{0,23})$/i;
const SELECTOR='0x5c60da1b';
const slot=['implementation','beacon','admin','legacy','legacyAdmin'];
const parseAddress=raw=>typeof raw==='string'&&/^0x0{24}[a-f0-9]{40}$/i.test(raw)?raw.toLowerCase():null;
const nonzero=raw=>raw&&BigInt(raw)!==0n?address('0x'+raw.slice(-40)):null;
const getHash=(header,block)=>header?.number===block&&HASH.test(header.hash||'')?header.hash.toLowerCase():null;
const limitRead=async(rpc,method,params)=>{
 let timer;
 try{return await Promise.race([rpc(method,params,{timeoutMs:2200}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),2300);})]);}
 finally{clearTimeout(timer);}
};
// Bounded spot checks. The slot value or beacon response is an observation,
// never proof that the unreviewed outer runtime actually delegates there.
async function collect({network,token,blocks,providers,checkpoint=[]}){
 const cfg=chain(network),subject=address(token);
 if(!subject||!Array.isArray(blocks)||!blocks.length||blocks.length>6||!blocks.every(x=>HEIGHT.test(x||''))||
  !Array.isArray(providers)||!providers.length||providers.length>2||
  providers.some(p=>typeof p?.rpc!=='function'||!/^[a-z0-9.-]{1,80}$/i.test(p.id||''))||
  new Set(providers.map(p=>p.id)).size!==providers.length||!Array.isArray(checkpoint)||checkpoint.length>12)throw Error('Invalid historical Mechanics scope');
 const heights=[...new Set(blocks.map(x=>x.toLowerCase()))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
 const attested=await Promise.all(providers.map(async p=>{try{verifyChainId(network,await limitRead(p.rpc,'eth_chainId',[]));return true;}catch{return false;}}));
 const observations=[];
 for(const block of heights){
  const at=await Promise.all(providers.map(async(p,i)=>{
   const stamp=recorder({chainId:cfg.chainId,network,address:subject,block,provider:p.id});
   const result=(x,status)=>stamp(x,'HISTORICAL_PROXY_STATE','Pinned headers and EIP-1967 / reviewed legacy slot locations',status);
   if(!attested[i])return result({reason:'RPC_CHAIN_UNAVAILABLE_OR_WRONG'},'UNKNOWN');
   const rpc=(method,params)=>limitRead(p.rpc,method,params);
   try{
    const before=getHash(await rpc('eth_getBlockByNumber',[block,false]),block);
    if(!before)return result({reason:'BLOCK_HEADER_UNAVAILABLE'},'UNKNOWN');
    const old=checkpoint.find(e=>e?.address===subject&&e.provider===p.id&&e.chainId===cfg.chainId&&e.block===block&&e.blockHash===before&&
     e.verificationStatus==='OBSERVED'&&slot.every(k=>parseAddress(e.slots?.[k]))&&(!e.beaconReply||address(e.beaconReply)===e.beaconReply));
    let slots,beaconReply=null;
    if(old){slots=old.slots;beaconReply=old.beaconReply||null;}
    else{
     const values=await Promise.all(slot.map(k=>rpc('eth_getStorageAt',[subject,SLOTS[k],block]).then(parseAddress).catch(()=>null)));
     slots=Object.fromEntries(slot.map((k,j)=>[k,values[j]]));
     const beacon=nonzero(slots.beacon);
     if(beacon)try{beaconReply=nonzero(parseAddress(await rpc('eth_call',[{from:subject,to:beacon,data:SELECTOR},block])));}catch{}
    }
    const after=getHash(await rpc('eth_getBlockByNumber',[block,false]),block);
    if(!after||before!==after)return result({blockHash:before,endBlockHash:after,slots,beaconReply,reason:'CANONICAL_HASH_CHANGED_OR_UNAVAILABLE'},'CONFLICTED');
    const unavailable=slot.some(k=>!slots[k]);
    return result({blockHash:after,slots,beaconReply,reusedCheckpoint:Boolean(old),
     ...(unavailable?{reason:'ONE_OR_MORE_STORAGE_SLOTS_UNAVAILABLE'}:{})},unavailable?'PARTIALLY_VERIFIED':'OBSERVED');
   }catch{return result({reason:'ARCHIVE_RPC_UNAVAILABLE'},'UNKNOWN');}
  }));
  observations.push(...at);
 }
 const snapshots=heights.map(block=>{
  const records=observations.filter(x=>x.block===block),usable=records.filter(x=>x.verificationStatus==='OBSERVED');
  const comparable=x=>JSON.stringify([x.blockHash,slot.map(k=>x.slots[k]),x.beaconReply]);
  if(records.some(x=>x.verificationStatus==='CONFLICTED')||new Set(usable.map(comparable)).size>1)
   return {block,verificationStatus:'CONFLICTED',reason:'PROVIDER_OR_CANONICAL_STATE_DISAGREEMENT'};
  if(!usable.length)return {block,verificationStatus:'UNKNOWN',reason:'NO_COMPLETE_PINNED_SLOT_OBSERVATION'};
  return {block,blockHash:usable[0].blockHash,verificationStatus:usable.length>1?'CORROBORATED_OBSERVATION':'OBSERVED',
   providers:usable.map(x=>x.provider),value:{implementationSlot:nonzero(usable[0].slots.implementation),legacySlot:nonzero(usable[0].slots.legacy),
    beaconSlot:nonzero(usable[0].slots.beacon),beaconReply:usable[0].beaconReply}};
 });
 const changes=[];
 for(let i=1;i<snapshots.length;i++){
  const from=snapshots[i-1],to=snapshots[i];
  if(!from.value||!to.value)continue;
  for(const key of Object.keys(from.value))if(from.value[key]!==to.value[key]&&!(key==='beaconReply'&&(!from.value[key]||!to.value[key])))
   changes.push({kind:key,fromBlock:from.block,toBlock:to.block,fromHash:from.blockHash,toHash:to.blockHash,
    from:from.value[key],to:to.value[key],verificationStatus:'HISTORICAL_OBSERVATION'});
 }
 return {chainId:cfg.chainId,network,address:subject,observations,snapshots,changes,
  scope:'Differences between sampled blocks only. This records values, not every intervening upgrade, caller-specific beacon routing, executable permissions or source attestations.'};
}
module.exports={collect};
