'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const core=require('../lib/core'),index=require('../lib/holder-candidates'),holderIndex=require('../lib/holder-index');
test('Robinhood Blockscout 403 switches to a resumable genesis Transfer scan and withholds unreconciled metrics',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-403-fallback-')),before={...process.env},address='0x'+'a'.repeat(40),old={fetch:global.fetch,context:core.context,rpc:core.rpc,call:core.call,balances:require('../lib/balance-reader').balances,load:holderIndex.load,save:holderIndex.save};let checkpoint=null;
 process.env.ARC_HOLDER_STORAGE='local';process.env.ARC_INDEX_CACHE_DIR=dir;process.env.ARC_HOLDER_PUBLISHED_DIR=path.join(dir,'published');
 try{
  global.fetch=async()=>({ok:false,status:403,json:async()=>({})});holderIndex.load=async()=>null;holderIndex.save=async(_name,value)=>{checkpoint=structuredClone(value);};
  core.context=async()=>({block:'0x1'});
  core.rpc=async method=>method==='eth_getLogs'?[]:{hash:'0x'+'f'.repeat(64)};
  core.call=async()=> '0x'+(100n).toString(16).padStart(64,'0');
  require('../lib/balance-reader').balances=async(_token,addresses)=>({values:addresses.map(()=> '0x'+(0n).toString(16).padStart(64,'0')),method:'fixture'});
  const result=await core.runWithChain(4663,()=>index.advance(address,{budgetMs:5000,maxPages:10,maxBatches:10}));
  assert.equal(result.reasonCode,'HOLDER_SUPPLY_RECONCILIATION_FAILED');
  assert.equal(result.value,null);
  assert.equal(result.status,'NOT_VERIFIED');
  assert.equal(checkpoint.phase,'DISCOVER');
  assert.equal(checkpoint.discoverySourceFallback,'BLOCKSCOUT_403_TRANSFER_LOGS_FROM_GENESIS');
 }finally{
  global.fetch=old.fetch;core.context=old.context;core.rpc=old.rpc;core.call=old.call;require('../lib/balance-reader').balances=old.balances;holderIndex.load=old.load;holderIndex.save=old.save;
  for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);
  await fs.rm(dir,{recursive:true,force:true});
 }
});
