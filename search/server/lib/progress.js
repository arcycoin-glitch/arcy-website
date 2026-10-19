'use strict';
const {AsyncLocalStorage}=require('node:async_hooks'),scope=new AsyncLocalStorage();
const schema=require('../schema'),{chain}=require('./chains');
function run(operation){return scope.run({snapshot:null},operation)}
function identity(network,base){
 const state=scope.getStore();if(!state||state.snapshot)return;
 const cfg=chain(network);
 if(base.chainId!==cfg.chainId||(base.network&&base.network!==network))throw Error('Progress chain mismatch');
 if(base.address?.toLowerCase()!==base.address||!/^0x[0-9a-f]{40}$/.test(base.address)||!/^0x[0-9a-f]+$/i.test(base.block||''))throw Error('Invalid progress anchor');
 state.snapshot={ok:true,schemaVersion:1,cardCount:5,network,chainId:cfg.chainId,address:base.address,block:base.block,
  scannedAt:base.scannedAt||new Date().toISOString(),token:{...base.token},
  tokenIdentity:require('./token-identity').verified(network,base.address)||{status:'NOT_VERIFIED',type:null,source:null},
  cards:Object.fromEntries(schema.map(c=>[c.id,require('./data-engine').formatCard(c.id,{fields:Object.fromEntries(c.fields.map(([id])=>[id,require('./data-engine').missing('Deep evidence analysis is still in progress.','ANALYSIS_PENDING',network)]))},cfg)])),
  warnings:['Deep analysis in progress; unresolved evidence is not a negative finding.']};
 const logo=require('./search-logo').localLogo(network,base.address);if(logo)state.snapshot.token.logoUrl=logo;
 require('./analysis-scope').emit('identity',structuredClone(state.snapshot));
}
function card(network,base,id,value){
 const state=scope.getStore();if(!state?.snapshot)return;
 const snapshot=state.snapshot;
 if(snapshot.network!==network||snapshot.address!==base.address||snapshot.block!==base.block)throw Error('Progress block/contract mismatch');
 snapshot.cards[id]=require('./data-engine').formatCard(id,value,chain(network));
 require('./analysis-scope').emit(id,structuredClone(snapshot));
}
module.exports={run,identity,card};
