// Export only reconciled COMPLETE documents; never publish a checkpoint/partial.
const path=require('node:path'),fs=require('node:fs/promises');
async function main(){const source=process.argv[2];if(!source)throw Error('Checkpoint directory required');
 process.env.ARC_HOLDER_STORAGE='local';process.env.ARC_INDEX_CACHE_DIR=path.resolve(source);
 const storage=require('../lib/holder-storage'),publication=require('../lib/holder-publication');
 for(const name of await fs.readdir(process.env.ARC_INDEX_CACHE_DIR)){if(!/^0x[0-9a-f]{40}-candidates\.v2\.json$/.test(name))continue;
  const a=name.slice(0,42),snapshot=await storage.snapshot(a+'-candidates');if(!snapshot)continue;
  await publication.publish(a,snapshot);console.log(JSON.stringify({contract:a,block:snapshot.block,holderCount:snapshot.holderCount,completedAt:snapshot.snapshot.completedAt}));
 }
}
main().catch(()=>{console.error('Snapshot export rejected; no secrets logged');process.exitCode=1;});
