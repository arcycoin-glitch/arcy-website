'use strict';
// Issue #96 Phase 3 — pons Launch Radar (Robinhood Chain). Synthetic chain with the documented ABI shapes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const keccak=require('../lib/keccak');
const pons=require('../lib/pons-launch-radar');
const {PONS}=pons;
const {makeChain,w,a32,tokenAddr,b32,sqrtOf}=require('./radar-helpers');

const HEAD=9500000,CONF=40,ACTIVE=PONS.factories[0].address,LEGACY=PONS.factories[1].address;
const addrTopic=a=>'0x'+a32(a);
const poolAddr=i=>'0x'+(0x7000+i).toString(16).padStart(40,'0');
const deployer='0x'+'de'.repeat(20);

function ponsFetcher({launches,swaps=[],liquidityPoolOverride={},noState=new Set(),extraLogs=[],ethAnswer,head:chainHead=HEAD}={}){
 const base=makeChain('robinhood',{head:chainHead,blockSeconds:1,tokens:Object.fromEntries(launches.map((l,i)=>[l.token,{decimals:18,symbol:'PN'+(i+1),name:'Pons Token '+(i+1)}])),feedAnswers:ethAnswer?{ETH:ethAnswer}:{}});
 const logs=[];let idx=0;
 for(const l of launches)logs.push({address:l.factory||ACTIVE,topics:[PONS.launchedTopic,addrTopic(l.token),addrTopic(deployer),addrTopic('0x'+'f1'.repeat(20))],
  data:'0x'+a32(PONS.weth)+a32(l.pool)+w(1)+w(2)+w(77)+w(HEAD+9999)+w(l.initialBuy??1000000000000000000n),blockNumber:'0x'+l.block.toString(16),logIndex:'0x'+(idx++).toString(16),transactionHash:'0x'+(0xa00+l.block).toString(16).padStart(64,'0'),removed:false});
 for(const s of swaps)logs.push({address:s.pool,topics:[PONS.swapTopic,addrTopic('0x'+'11'.repeat(20)),addrTopic('0x'+'22'.repeat(20))],
  data:'0x'+w(s.a0)+w(s.a1)+w(s.sqrt)+w(1000)+w(0),blockNumber:'0x'+s.block.toString(16),logIndex:'0x'+(idx++).toString(16),transactionHash:'0x'+(s.tx).toString(16).padStart(64,'0'),removed:false});
 logs.push(...extraLogs);
 return async(url,init)=>{
  const req=JSON.parse(init.body),{method,params}=req;
  const reply=result=>({ok:true,json:async()=>({jsonrpc:'2.0',id:req.id,result})});
  if(method==='eth_getLogs'){
   const f=params[0],from=Number(BigInt(f.fromBlock)),to=Number(BigInt(f.toBlock));
   const addrs=(Array.isArray(f.address)?f.address:[f.address]).map(x=>x.toLowerCase()),t0=f.topics[0].toLowerCase();
   return reply(logs.filter(l=>{const b=Number(BigInt(l.blockNumber));return b>=from&&b<=to&&addrs.includes(l.address.toLowerCase())&&l.topics[0].toLowerCase()===t0;}));
  }
  if(method==='eth_call'){
   const {to,data}=params[0],target=String(to).toLowerCase();
   const launch=launches.find(l=>l.token===target);
   if(data.startsWith(PONS.sel.getLaunchedToken)){
    const tok='0x'+data.slice(-40),l=launches.find(x=>x.token===tok);
    if(!l||noState.has(tok))return {ok:true,json:async()=>({jsonrpc:'2.0',id:req.id,error:{code:3,message:'execution reverted'}})};
    return reply('0x'+a32(l.token)+a32(deployer)+a32(PONS.weth)+a32('0x'+'cc'.repeat(20))+w(77)+w(1)+w(2)+w(HEAD+9999)+w(10n**27n)+w(l.token<PONS.weth?1:0)+w(10000)+w(1)+w(1000000000000000000n));
   }
   if(data.startsWith(PONS.sel.graduationStatus))return reply('0x'+w(2n*10n**18n)+w(42n*10n**17n)+w(0));
   if(launch&&data===PONS.sel.liquidityPool)return reply('0x'+a32(liquidityPoolOverride[launch.token]||launch.pool));
  }
  return base(url,init);
 };
}
const price=(tokenPerWeth)=>sqrtOf(tokenPerWeth); // token0=token, token1=WETH: raw price = WETH per token
const swap=(pool,block,tx,tokenAmt,wethAmt,p)=>({pool,block,tx,a0:-tokenAmt,a1:wethAmt,sqrt:sqrtOf(p)});
const E=10n**18n;

test('official topic0 hashes match the signatures documented by pons and the factories are the documented ones',()=>{
 assert.equal(PONS.launchedTopic,'0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a');
 assert.equal(PONS.swapTopic,'0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67');
 assert.equal(ACTIVE,'0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb');assert.equal(LEGACY,'0x0c37a24f5d23a486fa692d1500881d698b1f77a4');
 assert.equal(PONS.chainId,4663);assert.equal(PONS.network,'pons');
});

test('newest launches first, verified time/contract/tx count/volume with provenance',async()=>{
 const launches=[1,2,3].map(i=>({token:tokenAddr(i),pool:poolAddr(i),block:HEAD-CONF-(i*1000)}));
 launches.push({token:tokenAddr(4),pool:poolAddr(4),block:HEAD-CONF-5000,factory:LEGACY});
 const swaps=[swap(poolAddr(1),launches[0].block+10,1,1000n*E,2n*E,0.002),swap(poolAddr(1),launches[0].block+11,1,500n*E,1n*E,0.0021),swap(poolAddr(1),launches[0].block+50,2,200n*E,5n*E/10n,0.0025)];
 const out=await pons.inspect({fetcher:ponsFetcher({launches,swaps}),lookbackSeconds:48*3600,disableCache:true});
 assert.equal(out.ok,true);assert.equal(out.network,'pons');assert.equal(out.chainId,4663);
 assert.deepEqual(out.tokens.map(t=>t.address),[1,2,3,4].map(tokenAddr));
 const t=out.tokens[0];
 assert.equal(t.rank,1);assert.equal(t.symbol,'PN1');assert.equal(t.launchBlock,launches[0].block);
 assert.equal(t.launchTx,'0x'+(0xa00+launches[0].block).toString(16).padStart(64,'0'));
 assert.equal(t.swaps,3);assert.equal(t.txCount,2);
 assert.ok(Math.abs(t.volumeEth-3.5)<1e-9,'volumeEth '+t.volumeEth);
 assert.ok(Math.abs(t.volumeUsd-3.5*3000)<0.5,'usd '+t.volumeUsd);
 assert.ok(Math.abs(t.priceEth-0.0025)<1e-9);
 assert.equal(t.fieldStatus.volumeUsd,'VERIFIED_SINCE_LAUNCH');
 assert.equal(t.verification.factoryState&&t.verification.poolMatchesToken&&t.verification.pairIsWeth,true);
 assert.equal(t.provenance.topic0,PONS.launchedTopic);assert.match(t.provenance.explorerTx,/\/tx\/0x/);
 assert.equal(t.graduation.graduated,false);assert.ok(t.graduation.thresholdEth>t.graduation.pairedPrincipalEth);
 assert.equal(out.tokens[3].factoryLabel,'legacy');
 assert.ok(Date.parse(t.launchedAt)<Date.parse(out.asOf));
 assert.equal(out.tokens[1].swaps,0);assert.equal(out.tokens[1].txCount,0);assert.equal(out.tokens[1].volumeEth,0);
});

test('only the 10 newest launches inside the window are shown; older and foreign-factory events are excluded',async()=>{
 const launches=Array.from({length:14},(_,i)=>({token:tokenAddr(i+1),pool:poolAddr(i+1),block:HEAD-CONF-100-i*10}));
 launches.push({token:tokenAddr(99),pool:poolAddr(99),block:HEAD-CONF-400000}); // far older than 48h
 const foreign=[{address:'0x'+'99'.repeat(20),topics:[PONS.launchedTopic,addrTopic(tokenAddr(77)),addrTopic(deployer),addrTopic(deployer)],data:'0x'+'0'.repeat(448),blockNumber:'0x'+(HEAD-CONF-5).toString(16),logIndex:'0x1',transactionHash:'0x'+'1'.repeat(64),removed:false}];
 const out=await pons.inspect({fetcher:ponsFetcher({launches,extraLogs:foreign}),disableCache:true});
 assert.equal(out.tokens.length,10);assert.deepEqual(out.tokens.map(t=>t.address),Array.from({length:10},(_,i)=>tokenAddr(i+1)));
 assert.ok(!out.tokens.some(t=>t.address===tokenAddr(77)||t.address===tokenAddr(99)));
 assert.equal(out.coverage.launchesInWindow,14);
});

test('unverifiable evidence is marked UNAVAILABLE instead of being filled in',async()=>{
 const launches=[{token:tokenAddr(1),pool:poolAddr(1),block:HEAD-CONF-100},{token:tokenAddr(2),pool:poolAddr(2),block:HEAD-CONF-200}];
 const swaps=[swap(poolAddr(1),HEAD-CONF-90,1,1000n*E,2n*E,0.002),swap(poolAddr(2),HEAD-CONF-190,2,1000n*E,2n*E,0.002)];
 const out=await pons.inspect({fetcher:ponsFetcher({launches,swaps,liquidityPoolOverride:{[tokenAddr(1)]:poolAddr(55)},noState:new Set([tokenAddr(2)])}),disableCache:true});
 const [a,b]=out.tokens;
 assert.equal(a.verification.poolMatchesToken,false);assert.equal(a.volumeUsd,null);assert.equal(a.priceUsd,null);assert.equal(a.fieldStatus.volumeUsd,'UNAVAILABLE');
 assert.equal(a.txCount,1); // raw event count is still evidenced
 assert.equal(b.verification.factoryState,false);assert.equal(b.volumeUsd,null);assert.equal(b.fieldStatus.priceUsd,'UNAVAILABLE');
});

test('no launches in the window is an honest empty result, not an error and not invented rows',async()=>{
 const out=await pons.inspect({fetcher:ponsFetcher({launches:[]}),disableCache:true});
 assert.equal(out.ok,true);assert.deepEqual(out.tokens,[]);assert.match(out.coverage.notes,/No launches/);
});

test('stale Chainlink ETH/USD leaves USD fields unavailable but keeps verified ETH values',async()=>{
 const launches=[{token:tokenAddr(1),pool:poolAddr(1),block:HEAD-CONF-100}];
 const swaps=[swap(poolAddr(1),HEAD-CONF-90,1,1000n*E,2n*E,0.002)];
 const f=ponsFetcher({launches,swaps,ethAnswer:-5n});
 const out=await pons.inspect({fetcher:f,disableCache:true});
 assert.equal(out.tokens[0].volumeUsd,null);assert.equal(out.tokens[0].fieldStatus.volumeUsd,'UNAVAILABLE');assert.ok(out.tokens[0].volumeEth>0);
});

test('wrong chain id fails closed',async()=>{
 const f=ponsFetcher({launches:[]});
 const wrong=async(u,i)=>{const r=JSON.parse(i.body);if(r.method==='eth_chainId')return {ok:true,json:async()=>({jsonrpc:'2.0',id:r.id,result:'0x1'})};return f(u,i);};
 await assert.rejects(pons.inspect({fetcher:wrong,disableCache:true}),e=>e.code==='RADAR_RPC_CHAIN_MISMATCH');
});

test('snapshot validation is fail-closed',()=>{
 const good=()=>({ok:true,network:'pons',chainId:4663,snapshot:{network:'pons',headTimestamp:Math.floor(Date.now()/1000)-20},
  tokens:[{address:tokenAddr(1),symbol:'A',launchedAt:new Date().toISOString(),launchBlock:5,launchTx:'0x'+'a'.repeat(64)}]});
 assert.equal(pons.validateSnapshot(good()).servedFrom,'signed-snapshot');
 const code=s=>{try{pons.validateSnapshot(s);return 'OK';}catch(e){return e.code;}};
 assert.equal(code({...good(),chainId:1}),'RADAR_SNAPSHOT_CHAIN_MISMATCH');
 assert.equal(code({...good(),snapshot:{network:'pons',headTimestamp:1}}),'RADAR_SNAPSHOT_STALE');
 assert.equal(code({...good(),tokens:[{address:'x'}]}),'RADAR_SNAPSHOT_INVALID');
});

// ---- incremental indexer + signed snapshot ---------------------------------------------------------
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const indexer=require('../lib/pons-launch-indexer'),storage=require('../lib/market-radar-storage');
function withStore(fn){return async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pons-')),{privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),saved={...process.env};
 Object.assign(process.env,{ARC_RADAR_MIN_INTERVAL_MS:'0',ARC_RADAR_DIR:dir,ARC_RADAR_SIGNING_KEY:privateKey.export({type:'pkcs8',format:'pem'}),ARC_RADAR_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'})});
 try{await fn({dir,pub:process.env.ARC_RADAR_PUBLIC_KEY});}
 finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);fs.rmSync(dir,{recursive:true,force:true});}};}

test('indexer publishes a signed snapshot equal to the live index and a second run reads only new blocks',withStore(async({pub})=>{
 const launches=[1,2,3].map(i=>({token:tokenAddr(i),pool:poolAddr(i),block:HEAD-CONF-i*1000}));
 const swaps=[swap(poolAddr(1),launches[0].block+10,1,1000n*E,2n*E,0.002),swap(poolAddr(1),launches[0].block+11,1,500n*E,1n*E,0.0021),swap(poolAddr(2),launches[1].block+5,3,100n*E,1n*E,0.01)];
 const r=await indexer.run({fetcher:ponsFetcher({launches,swaps}),budgetMs:60000});
 assert.equal(r.status,'published');
 const env=await storage.envelopeOf('pons'),snap=storage.unpack(env,pub);
 assert.equal(snap.snapshot.network,'pons');
 const live=await pons.inspect({fetcher:ponsFetcher({launches,swaps}),disableCache:true});
 assert.deepEqual(snap.tokens.map(t=>[t.address,t.swaps,t.txCount,t.volumeEth]),live.tokens.map(t=>[t.address,t.swaps,t.txCount,t.volumeEth]));
 assert.equal(pons.validateSnapshot(snap).servedFrom,'signed-snapshot');
 // second run: chain advanced by 200 blocks, one new launch and new swaps
 const more=[...launches,{token:tokenAddr(4),pool:poolAddr(4),block:HEAD+100}];
 const more2=[...swaps,swap(poolAddr(1),HEAD+60,9,200n*E,5n*E/10n,0.0025),swap(poolAddr(4),HEAD+120,10,1000n*E,3n*E,0.003)];
 const seen=[],inner=ponsFetcher({launches:more,swaps:more2,head:HEAD+200});
 const counting=async(u,i)=>{const q=JSON.parse(i.body);if(q.method==='eth_getLogs')seen.push([Number(BigInt(q.params[0].fromBlock)),Number(BigInt(q.params[0].toBlock))]);return inner(u,i);};
 const r2=await indexer.run({fetcher:counting,budgetMs:60000});
 assert.equal(r2.status,'published');
 assert.ok(seen.length>0&&seen.every(([a])=>a>=HEAD-CONF+1),'rescanned old blocks: '+JSON.stringify(seen.slice(0,3)));
 const snap2=storage.unpack(await storage.envelopeOf('pons'),pub);
 assert.equal(snap2.tokens[0].address,tokenAddr(4));assert.equal(snap2.tokens[0].txCount,1);
 const t1=snap2.tokens.find(t=>t.address===tokenAddr(1));assert.equal(t1.swaps,3);assert.equal(t1.txCount,2);
}));

test('indexer never publishes while launch/swap cursors are behind the head',withStore(async()=>{
 const f=ponsFetcher({launches:[{token:tokenAddr(1),pool:poolAddr(1),block:HEAD-CONF-100}]});
 const r=await indexer.run({fetcher:f,budgetMs:1});
 assert.equal(r.status,'catching_up');assert.equal(await storage.envelopeOf('pons'),null);
}));

test('API: pons is a valid Radar network, fail-closed when not enabled, other invalid networks still 400',async()=>{
 const handler=require('../search/server/api/radar');
 const call=async(chain,env)=>{
  const saved={...process.env},savedFetch=global.fetch;
  for(const k of ['MARKET_RADAR_ONCHAIN_ENABLED','MARKET_RADAR_SOURCE','MARKET_RADAR_PROVIDER'])delete process.env[k];
  Object.assign(process.env,env);global.fetch=async()=>{throw new TypeError('fetch failed');};pons._cache.clear();
  const res={headers:{},setHeader(a,b){this.headers[a]=b;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
  const orig=console.warn;console.warn=()=>{};
  try{await handler({method:'GET',query:{chain}},res);}finally{console.warn=orig;global.fetch=savedFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
  return res;};
 assert.equal((await call('pons',{})).body.error,'RADAR_NOT_ENABLED');
 assert.equal((await call('bitcoin',{MARKET_RADAR_ONCHAIN_ENABLED:'true'})).code,400);
 const on=await call('pons',{MARKET_RADAR_ONCHAIN_ENABLED:'true',VERCEL_ENV:'production'});
 assert.equal(on.code,503);assert.equal(on.body.network,'pons');assert.equal(on.body.diagnostics,undefined);assert.equal(on.body.tokens,undefined);
 const prev=await call('pons',{MARKET_RADAR_ONCHAIN_ENABLED:'true',VERCEL_ENV:'preview'});
 assert.equal(prev.body.diagnostics.network,'pons');
});
