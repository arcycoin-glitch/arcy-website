process.env.ARC_HOLDER_WORKER_RPC='1';
const storage=require('../lib/holder-storage'),refresh=require('../lib/holder-refresh');
const {setTimeout:sleep}=require('node:timers/promises');
async function main(){
 if(storage.mode()!=='redis')throw Error('Durable Redis configuration required');
 const args=process.argv.slice(2),once=args.includes('--once'),addresses=args.filter(a=>a!=='--once').map(a=>a.toLowerCase());
 for(const a of addresses){if(!/^0x[0-9a-f]{40}$/.test(a))throw Error('Exact contract address required');if(!await storage.enqueue(a))throw Error('Holder queue full');}
 let stopped=false;const idle=new AbortController();
 const stop=()=>{stopped=true;idle.abort();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 console.log(JSON.stringify({event:'HOLDER_WORKER_STARTED',chainId:5042,storage:'redis'}));
 try{
  do{
   let results=[];
   try{results=await refresh.run({limit:5,budgetMs:40000,incompleteDelayMs:5000});console.log(JSON.stringify({event:'HOLDER_WORKER_BATCH',results}));}
   catch{console.error(JSON.stringify({event:'HOLDER_WORKER_STORAGE_UNAVAILABLE'}));if(once)throw Error('Holder worker unavailable');}
   if(once||stopped)break;
   try{await sleep(results.length?5000:30000,undefined,{signal:idle.signal});}catch(e){if(e.name!=='AbortError')throw e;}
  }while(!stopped);
 }finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
main().catch(()=>{console.error('Holder worker unavailable. Check private Redis configuration and provider health.');process.exitCode=1;});
