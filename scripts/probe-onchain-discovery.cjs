'use strict';
// Read-only: run Radar's on-chain pool discovery against the real RPCs of all three chains (CI only).
const op=require('../lib/radar-v2/onchain-pools');
const RPC={arc:require('../search/server/lib/arc-rpc').rpc,ethereum:require('../search/server/lib/eth').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc};
(async()=>{for(const n of ['arc','ethereum','robinhood']){const t=Date.now();
 try{const r=await op.discover(n,RPC[n]);console.log('::notice title=discovery-'+n+'::'+JSON.stringify({ms:Date.now()-t,status:r.status,tokens:r.tokens.length,pools:r.poolCount,bySource:r.bySource,scanned:r.scanned,sample:r.tokens.slice(0,5).map(x=>[x.symbol,x.address.slice(0,10),x.pools.map(p=>p.dex).join('|')])}).slice(0,3800));}
 catch(e){console.log('::notice title=discovery-'+n+'::'+JSON.stringify({error:String(e.message).slice(0,200)}));}}})();
