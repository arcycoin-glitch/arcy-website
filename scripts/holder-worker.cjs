process.env.ARC_HOLDER_WORKER_RPC='1';
const storage=require('../lib/holder-storage'),refresh=require('../lib/holder-refresh');
const {setTimeout:sleep}=require('node:timers/promises');
async function refreshUnlocks(){
 let stored;
 // A durable worker must never create a calendar beside the source checkout or
 // inside an ephemeral container. The production image configures this volume.
 if(!process.env.ARC_UNLOCK_EDITION_DIR&&!process.env.ARC_HOLDER_PUBLISHED_DIR)return null;
 try{stored=require('../lib/unlock-storage');if(!await stored.due())return null;const edition=await require('../lib/unlock-calendar').generate({trigger:'worker'});await stored.publish(edition);return {state:'UPDATED',eventCount:edition.events.length,refreshAt:edition.refreshAt};}
 catch(error){try{await stored?.failure(error,Date.now(),'worker');}catch{}return {state:'FAILED',reasonCode:error?.code||'UNLOCK_REFRESH_FAILED'};}
}
async function main(){
 if(storage.mode()!=='redis'&&!(process.env.ARC_HOLDER_STORAGE==='local'&&process.env.ARC_INDEX_CACHE_DIR))throw Error('Durable Redis or explicit persistent volume required');
 const args=process.argv.slice(2),once=args.includes('--once'),addresses=args.filter(a=>a!=='--once').map(a=>a.toLowerCase());
 for(const a of addresses){if(!/^0x[0-9a-f]{40}$/.test(a))throw Error('Exact contract address required');if(!await storage.enqueue(a))throw Error('Holder queue full');}
 let stopped=false;const idle=new AbortController();
 const stop=()=>{stopped=true;idle.abort();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const server=require('../lib/holder-worker-http').start();
 console.log(JSON.stringify({event:'HOLDER_WORKER_STARTED',chainId:5042,storage:storage.mode()}));
 try{
  do{
   let results=[];
   const unlocks=await refreshUnlocks();
   try{results=await refresh.run({limit:5,budgetMs:40000,incompleteDelayMs:5000});
    for(const result of results)if(process.env.ARC_HOLDER_PUBLISHED_DIR&&['COMPLETE','STALE'].includes(result.state)){try{const snapshot=await storage.snapshot(result.contract+'-candidates');if(snapshot)await require('../lib/holder-publication').publish(result.contract,snapshot);}catch{console.error(JSON.stringify({event:'HOLDER_PUBLICATION_FAILED',contract:result.contract}));}}
    console.log(JSON.stringify({event:'HOLDER_WORKER_BATCH',results,unlocks}));}
   catch{console.error(JSON.stringify({event:'HOLDER_WORKER_STORAGE_UNAVAILABLE'}));if(once)throw Error('Holder worker unavailable');}
   if(once||stopped)break;
   try{await sleep(results.length?5000:30000,undefined,{signal:idle.signal});}catch(e){if(e.name!=='AbortError')throw e;}
  }while(!stopped);
 }finally{server?.close();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
main().catch(()=>{console.error('Holder worker unavailable. Check private Redis configuration and provider health.');process.exitCode=1;});
