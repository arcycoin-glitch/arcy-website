'use strict';
// End-to-end over the real worker HTTP server: Search enqueue (Bearer token) -> worker tick -> signed publication ->
// Search reads and verifies it. Same delivery model as holder snapshots; no Redis involved.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const publication=require('../lib/risk-engine/publication');
const worker=require('../lib/risk-engine/worker');
const shadow=require('../lib/risk-engine/shadow');
const T='0x'+'ab'.repeat(20),NOW=Date.now();
let dir,server,port,keys,saved;
const freePort=()=>new Promise(r=>{const s=net.createServer().listen(0,()=>{const p=s.address().port;s.close(()=>r(p));});});
before(async()=>{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-risk-pub-'));port=await freePort();
 keys=crypto.generateKeyPairSync('ed25519');
 saved={...process.env};
 Object.assign(process.env,{PORT:String(port),ARC_HOLDER_QUEUE_TOKEN:'queue-secret',ARC_HOLDER_SIGNING_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}),
  ARC_HOLDER_PUBLISHED_DIR:path.join(dir,'published'),ARC_RISK_STORAGE:'local',ARC_RISK_STORE_DIR:path.join(dir,'store'),ARC_AUTONOMY_RISK_WORKER_ENABLED:'1'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.ARC_INDEX_REDIS_URL;
 server=require('../lib/holder-worker-http').start();await new Promise(r=>server.listening?r():server.once('listening',r));
});
after(async()=>{server&&server.close();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);await fs.rm(dir,{recursive:true,force:true});});
// The Search side requires https origins; route them to the local worker.
const local=async(url,init)=>fetch(String(url).replace('https://worker.test','http://127.0.0.1:'+port),init);
const searchEnv=()=>({ARC_AUTONOMY_RISK_ENGINE_ENABLED:'1',ARC_HOLDER_QUEUE_URL:'https://worker.test/queue',ARC_HOLDER_PUBLISHED_URL:'https://worker.test/snapshots/',
 ARC_HOLDER_QUEUE_TOKEN:'queue-secret',ARC_HOLDER_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'})});
const record={schemaVersion:1,metricId:'risk.mint-authority',network:'ethereum',token:T,scope:null,unit:'boolean',value:true,state:'VERIFIED_ONCHAIN'};

test('Search enqueues through the worker, the worker publishes a signed snapshot, Search verifies and reads it',async()=>{
 const report={address:T,block:'0x64',network:'ethereum',cards:{}},before=JSON.stringify(report);
 // 1) Search request path: authenticated enqueue, no snapshot yet.
 const first=await shadow.runIfEnabled(report,{network:'ethereum',env:searchEnv(),fetcher:local,log:()=>{}});
 assert.deepEqual({s:first.state,q:first.queue,v:first.view},{s:'READ',q:'QUEUED',v:null});assert.equal(JSON.stringify(report),before);
 // 2) Worker tick: the queued job runs (analysis injected), the snapshot is stored and published signed.
 worker._reset();
 const out=await worker.tick({fetcher:async()=>new Response(JSON.stringify({result:'0x100'})),analyze:async a=>({scope:null,block:{number:'250'},generatedAt:new Date(NOW).toISOString(),records:[{...record,token:a.token}],
  findings:[{ruleId:'privileged-minting',status:'UNKNOWN'}],evidenceGaps:{},producers:{},operators:{authority:[{state:'OK'}]},cost:{rpcCalls:5,totalMs:10},ledger:{state:'RECORDED',history:'PRESERVED'}})});
 assert.equal(out.results[0].state,'COMPLETE');assert.equal(out.results[0].publication,'PUBLISHED');
 // 3) Search reads the signed snapshot through the worker origin and verifies it.
 const remote=publication.remote({env:searchEnv(),fetcher:local});
  const snap=await remote.getSnapshot('ethereum',T);assert.equal(snap.block.number,'250');assert.equal(snap.records[0].token,T);
 const again=await shadow.runIfEnabled(report,{network:'ethereum',env:searchEnv(),fetcher:local,log:()=>{}});
 assert.equal(again.view.token,T);assert.equal(JSON.stringify(report),before); // public flag OFF: nothing attached
 // 4) Worker restart: in-memory state gone, the published file is still served.
 worker._reset();assert.ok(await remote.getSnapshot('ethereum',T));
});

test('tampered, unsigned, foreign-key or mismatching publications are ignored; enqueue needs the token and an enabled worker',async()=>{
 const remote=publication.remote({env:searchEnv(),fetcher:local});
 const file=path.join(process.env.ARC_HOLDER_PUBLISHED_DIR,'risk','ethereum-'+T+'.json'),orig=await fs.readFile(file,'utf8'),d=JSON.parse(orig);
 const writeAndRead=async doc=>{await fs.writeFile(file,JSON.stringify(doc));return remote.getSnapshot('ethereum',T);};
 // Payload edited after signing.
 assert.equal(await writeAndRead({...d,payload:d.payload.replace('"250"','"999"')}),null);
 // Unsigned document.
 assert.equal(await writeAndRead(JSON.parse(d.payload)),null);
 // Signed with another key.
 const other=crypto.generateKeyPairSync('ed25519');assert.equal(await writeAndRead({payload:d.payload,signature:crypto.sign(null,Buffer.from(d.payload),other.privateKey).toString('base64')}),null);
 // Correctly signed but for another token, or with a record digest that does not match.
 const body=JSON.parse(d.payload),sign=b=>{const p=JSON.stringify(b);return {payload:p,signature:crypto.sign(null,Buffer.from(p),keys.privateKey).toString('base64')};};
 assert.equal(await writeAndRead(sign({...body,token:'0x'+'cd'.repeat(20)})),null);
 assert.equal(await writeAndRead(sign({...body,snapshot:{...body.snapshot,records:[]}})),null);
 await fs.writeFile(file,orig);assert.ok(await remote.getSnapshot('ethereum',T));
 // Enqueue: wrong token -> 401; worker flag OFF -> RISK_WORKER_DISABLED; plain http origins are never used.
 const bad=publication.remote({env:{...searchEnv(),ARC_HOLDER_QUEUE_TOKEN:'wrong'},fetcher:local});
 await assert.rejects(bad.enqueue('ethereum',T),{code:'RISK_QUEUE_UNAUTHORIZED'});
 process.env.ARC_AUTONOMY_RISK_WORKER_ENABLED='0';
 try{await assert.rejects(remote.enqueue('ethereum',T),{code:'RISK_WORKER_DISABLED'});}finally{process.env.ARC_AUTONOMY_RISK_WORKER_ENABLED='1';}
 assert.equal(publication.remote({env:{...searchEnv(),ARC_HOLDER_PUBLISHED_URL:'http://worker.test/snapshots/'}}),null);
 assert.equal(publication.remote({env:{...searchEnv(),ARC_HOLDER_PUBLIC_KEY:''}}),null);
 // Without a signing key the worker publishes nothing (Search reads nothing), and says so.
 assert.deepEqual(await publication.publish('ethereum',T,{records:[]},{ARC_HOLDER_PUBLISHED_DIR:dir}),{state:'NOT_PUBLISHED',reasonCode:'SIGNING_KEY_NOT_CONFIGURED'});
 // Unknown routes and malformed identities are not served.
 assert.notEqual((await fetch('http://127.0.0.1:'+port+'/risk/snapshots/polygon/'+T+'.json')).status,200);
});
