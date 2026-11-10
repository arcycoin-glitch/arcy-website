'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const catalog=require('../lib/pulse-onchain/catalog');
const engine=require('../lib/pulse-onchain/engine');
const transport=require('../lib/pulse-onchain/rpc');
const watchlist=require('../lib/pulse-onchain/watchlist');
const onchain=require('../lib/pulse-onchain');
const sim=require('./helpers/onchain-sim.cjs');

const T=key=>catalog.EVENTS.find(e=>e.key===key).topic0;
const ETH=Object.fromEntries(watchlist.network('ethereum').tokens.map(t=>[t.symbol,t.address]));
const V3=watchlist.NETWORKS.ethereum.factories.find(f=>f.architecture==='v3').address;
const HEAD=20000000,GENESIS=1790000000;
const NOW=(GENESIS+HEAD*12+30)*1000;
const URLS=['https://rpc.example.test'];
const ethNode=(extra={})=>sim.node({chainId:1,head:HEAD,finalized:HEAD-70,genesisTime:GENESIS,...extra});
const run=(node,options={})=>engine.scan({chain:'ethereum',now:NOW,fetcher:node.fetcher,urls:URLS,...options});

test('event topics are derived from canonical signatures and match the published hashes',()=>{
 assert.equal(T('OWNERSHIP_TRANSFERRED'),'0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0');
 assert.equal(T('TRANSFER'),'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
 assert.equal(T('UPGRADED'),'0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b');
 assert.equal(T('V3_POOL_CREATED'),'0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118');
 assert.equal(new Set(catalog.EVENTS.map(e=>e.topic0)).size,catalog.EVENTS.length);
});

test('decoder rejects look-alike logs instead of guessing',()=>{
 const base={address:ETH.UNI,blockNumber:'0x10',blockHash:sim.h32('b'),transactionHash:sim.h32('t'),logIndex:'0x1'};
 // ERC-721 Transfer shares topic0 with ERC-20 Transfer but indexes the token id (4 topics, no data).
 assert.equal(catalog.decode({...base,topics:[T('TRANSFER'),catalog.ZERO_TOPIC,sim.addr(sim.A(7)),sim.word(1)],data:'0x'}).rejected,'LAYOUT_MISMATCH');
 // An ordinary transfer is not a supply event.
 assert.equal(catalog.decode({...base,topics:[T('TRANSFER'),sim.addr(sim.A(1)),sim.addr(sim.A(2))],data:sim.word(5)}).rejected,'NOT_A_SUPPLY_EVENT');
 assert.equal(catalog.decode({...base,removed:true,topics:[T('PAUSE_LEGACY')],data:'0x'}).rejected,'REMOVED_BY_REORG');
 assert.equal(catalog.decode({...base,topics:[sim.h32('unknown')],data:'0x'}).rejected,'UNKNOWN_TOPIC');
 assert.equal(catalog.decode({...base,blockHash:'0x12',topics:[T('PAUSE_LEGACY')],data:'0x'}).rejected,'MALFORMED_LOG');
 // A non-address word in an address position is refused.
 assert.equal(catalog.decode({...base,topics:[T('UPGRADED'),sim.h32('not-an-address')],data:'0x'}).rejected,'DECODE_FAILED');
 // Ownable variants that do not index their arguments are decoded from data.
 const legacy=catalog.decode({...base,topics:[T('OWNERSHIP_TRANSFERRED')],data:'0x'+sim.addr(sim.A(1)).slice(2)+sim.addr(sim.A(2)).slice(2)});
 assert.deepEqual([legacy.details.previousOwner,legacy.details.newOwner],[sim.A(1),sim.A(2)]);
});

test('scan detects ownership, upgrade, role, supply and new-pool events with full evidence fields',async()=>{
 const node=ethNode(),newOwner=sim.A(0xbeef),impl=sim.A(0x1234),minted=2n*10n**16n,supply=10n**18n;
 const ownerTx=node.log({address:ETH.ONDO,topics:[T('OWNERSHIP_TRANSFERRED'),sim.addr(sim.A(0xaaaa)),sim.addr(newOwner)],block:HEAD-200});
 node.log({address:ETH.USDC,topics:[T('UPGRADED'),sim.addr(impl)],block:HEAD-300});
 node.log({address:ETH.USDY,topics:[T('ROLE_GRANTED'),catalog.DEFAULT_ADMIN_ROLE,sim.addr(sim.A(0x77)),sim.addr(sim.A(0x78))],block:HEAD-400});
 node.log({address:ETH.USDC,topics:[T('TRANSFER'),catalog.ZERO_TOPIC,sim.addr(sim.A(0x99))],data:sim.word(minted),block:HEAD-500});
 node.log({address:ETH.USDC,topics:[T('TRANSFER'),catalog.ZERO_TOPIC,sim.addr(sim.A(0x98))],data:sim.word(10n),block:HEAD-501});
 node.log({address:V3,topics:[T('V3_POOL_CREATED'),sim.addr(ETH.LINK),sim.addr(ETH.USDC),sim.word(3000)],data:'0x'+sim.word(60).slice(2)+sim.addr(sim.A(0x5001)).slice(2),block:HEAD-600});
 node.log({address:V3,topics:[T('V3_POOL_CREATED'),sim.addr(sim.A(0x4444)),sim.addr(ETH.LINK),sim.word(10000)],data:'0x'+sim.word(200).slice(2)+sim.addr(sim.A(0x5002)).slice(2),block:HEAD-601});
 node.state.calls[ETH.ONDO+':'+catalog.SELECTORS.owner]=sim.addr(newOwner);
 node.state.calls[ETH.USDC+':'+catalog.SELECTORS.totalSupply]=sim.word(supply);
 node.state.storage[ETH.USDC+':'+catalog.IMPLEMENTATION_SLOT]=sim.addr(impl);
 const result=await run(node);
 assert.equal(result.status,'EVENTS_DETECTED');assert.equal(result.complete,true);assert.equal(result.emptyState,null);
 assert.deepEqual(result.events.map(e=>e.category).sort(),['CONTRACT_UPGRADE','NEW_POOL','OWNERSHIP_CHANGE','ROLE_CHANGE','SUPPLY_CHANGE']);
 for(const e of result.events){
  assert.equal(e.network,'ethereum');assert.equal(e.chainId,1);
  assert.match(e.id,/^poc1-[0-9a-f]{24}$/);
  assert.ok(Number.isFinite(Date.parse(e.eventTimestamp)));assert.ok(Number.isFinite(Date.parse(e.detectedAt)));
  assert.equal(e.evidence.source,'JSON-RPC eth_getLogs');
  assert.match(e.transactionHash,/^0x[0-9a-f]{64}$/);assert.equal(e.evidence.reference,'https://etherscan.io/tx/'+e.transactionHash);
  assert.match(e.verification,/^ONCHAIN_CONFIRMED_/);assert.equal(e.confirmation.status,'CONFIRMED');assert.equal(e.confirmation.canonicalHashChecked,true);
  assert.ok(['HIGH','MEDIUM'].includes(e.materiality.level));assert.equal(e.freshness.status,'LIVE');
 }
 const owner=result.events.find(e=>e.category==='OWNERSHIP_CHANGE');
 assert.equal(owner.transactionHash,ownerTx.transactionHash);assert.equal(owner.details.newOwner,newOwner);
 assert.equal(owner.verification,'ONCHAIN_CONFIRMED_STATE_CORROBORATED');assert.equal(owner.stateCheck.result,'IN_EFFECT_AT_HEAD');
 assert.equal(result.events.find(e=>e.category==='CONTRACT_UPGRADE').verification,'ONCHAIN_CONFIRMED_STATE_CORROBORATED');
 // A role change is confirmed by its log; no permission is inferred from the role id.
 assert.equal(result.events.find(e=>e.category==='ROLE_CHANGE').verification,'ONCHAIN_CONFIRMED_LOG');
 const mint=result.events.find(e=>e.category==='SUPPLY_CHANGE');
 assert.equal(mint.details.direction,'MINT');assert.equal(mint.materiality.level,'HIGH');assert.equal(mint.materiality.shareOfSupplyPpm,20000);
 // Dust mint and a pool against an unreviewed counterpart are counted, never shown.
 assert.equal(result.counts.filtered.belowMateriality,2);
 assert.deepEqual(result.events.find(e=>e.category==='NEW_POOL').details.watchedTokens.sort(),['LINK','USDC']);
 assert.ok(result.cost.rpcCalls<=watchlist.NETWORKS.ethereum.maxCalls);
 assert.equal(result.window.blocksCovered,result.window.blocksPlanned);
});

test('a mint and burn that net to zero inside one transaction is not a supply change',async()=>{
 const node=ethNode(),flash=sim.h32('flash-mint-tx'),partial=sim.h32('partial-tx'),supply=10n**18n,big=11n*10n**16n;
 node.state.calls[ETH.DAI+':'+catalog.SELECTORS.totalSupply]=sim.word(supply);
 // Flash mint: 11% of supply minted and burned in the same transaction.
 node.log({address:ETH.DAI,topics:[T('TRANSFER'),catalog.ZERO_TOPIC,sim.addr(sim.A(0x51))],data:sim.word(big),block:HEAD-150,tx:flash});
 node.log({address:ETH.DAI,topics:[T('TRANSFER'),sim.addr(sim.A(0x51)),catalog.ZERO_TOPIC],data:sim.word(big),block:HEAD-150,tx:flash});
 // Mint 5% and burn 3% in one transaction: one event for the 2% net mint.
 node.log({address:ETH.DAI,topics:[T('TRANSFER'),catalog.ZERO_TOPIC,sim.addr(sim.A(0x52))],data:sim.word(5n*10n**16n),block:HEAD-160,tx:partial});
 node.log({address:ETH.DAI,topics:[T('TRANSFER'),sim.addr(sim.A(0x52)),catalog.ZERO_TOPIC],data:sim.word(3n*10n**16n),block:HEAD-160,tx:partial});
 const result=await run(node);
 assert.equal(result.events.length,1);assert.equal(result.counts.filtered.netZeroInTransaction,3);
 assert.equal(result.events[0].transactionHash,partial);assert.equal(result.events[0].details.direction,'MINT');assert.equal(result.events[0].details.netOfTransaction,true);
 assert.equal(result.events[0].materiality.shareOfSupplyPpm,20000);
});

test('a complete scan with no logs is an explicit scoped empty state',async()=>{
 const result=await run(ethNode());
 assert.equal(result.status,'NO_QUALIFYING_EVENTS');assert.equal(result.complete,true);
 assert.match(result.emptyState,/13 watched Ethereum contracts/);assert.match(result.emptyState,/not the whole network/);
 assert.equal(result.confirmation.policy,'FINALIZED_TAG');
});

test('a provider failure is never represented as a quiet network',async()=>{
 const node=ethNode();node.state.httpStatus=503;
 const result=await run(node);
 assert.equal(result.status,'PROVIDER_UNAVAILABLE');assert.equal(result.complete,false);assert.equal(result.reasonCode,'ONCHAIN_PROVIDER_UNAVAILABLE');
 assert.match(result.emptyState,/not a quiet network/);
 const limited=ethNode({failures:{eth_getLogs:{code:-32005,message:'rate limit exceeded'}}});
 const second=await run(limited);
 assert.equal(second.status,'PROVIDER_UNAVAILABLE');assert.notEqual(second.status,'NO_QUALIFYING_EVENTS');
});

test('a refused block range narrows the window; an exhausted budget reports partial coverage',async()=>{
 const node=ethNode({maxRange:400});
 node.log({address:ETH.AAVE,topics:[T('PAUSED')],data:sim.word(BigInt(sim.A(0x11))),block:HEAD-50});
 const result=await run(node);
 assert.equal(result.status,'PARTIAL_COVERAGE');assert.equal(result.complete,false);assert.equal(result.reasonCode,'ONCHAIN_RPC_BUDGET_EXHAUSTED');
 assert.ok(result.window.spanNarrowed>=1);assert.ok(result.window.blocksCovered<result.window.blocksPlanned);
 assert.ok(result.cost.rpcCalls<=watchlist.NETWORKS.ethereum.maxCalls);
 // Events from the part that was read are still reported, with their own confirmation.
 assert.equal(result.events.length,1);assert.equal(result.events[0].category,'PAUSE_STATE');
 const empty=await run(ethNode({maxRange:400}));
 assert.equal(empty.status,'PARTIAL_COVERAGE');assert.match(empty.emptyState,/not evidence of a quiet network/);
});

test('checkpoint range scans cover an oldest-first contiguous prefix pinned below the confirmed head',async()=>{
 const node=ethNode();
 const first=node.log({address:ETH.ONDO,topics:[T('OWNERSHIP_TRANSFERRED'),sim.addr(sim.A(1)),sim.addr(sim.A(2))],block:HEAD-2200});
 node.log({address:ETH.AAVE,topics:[T('PAUSED')],data:sim.word(BigInt(sim.A(0x11))),block:HEAD-2000});
 const from=HEAD-2300,to=HEAD-1900,result=await run(node,{range:{fromBlock:from,toBlock:to}});
 assert.equal(result.status,'EVENTS_DETECTED');assert.equal(result.complete,true);
 assert.equal(result.window.fromBlock,from);assert.equal(result.window.toBlock,to);assert.equal(result.window.blocksCovered,to-from+1);
 assert.match(result.window.toBlockHash,/^0x[0-9a-f]{64}$/);assert.equal(result.head.number,HEAD);
 assert.ok(result.events.some(e=>e.transactionHash===first.transactionHash));
 assert.ok(result.events.every(e=>e.blockNumber>=from&&e.blockNumber<=to&&e.confirmation.status==='CONFIRMED'));
 assert.ok(node.state.requests.every(method=>!['eth_sendTransaction','eth_sendRawTransaction'].includes(method)));
});

test('checkpoint range budget exhaustion reports only the contiguous prefix as partial',async()=>{
 const node=ethNode({maxRange:64}),from=HEAD-2300,to=HEAD-1900;
 const result=await run(node,{range:{fromBlock:from,toBlock:to},limits:{maxCalls:90}});
 assert.equal(result.complete,false);assert.equal(result.status,'PARTIAL_COVERAGE');
 assert.ok(result.window.blocksCovered<result.window.blocksPlanned);
 assert.equal(result.window.fromBlock,from);assert.ok(result.window.toBlock<to);
});

test('checkpoint scan can retain more events than the stateless card default without truncation',async()=>{
 const node=ethNode(),from=HEAD-2200,to=HEAD-2000;
 for(let i=0;i<13;i++)node.log({address:ETH.UNI,topics:[T('OWNERSHIP_TRANSFERRED'),sim.addr(sim.A(i+1)),sim.addr(sim.A(i+101))],data:'0x',block:HEAD-2150+i,tx:sim.h32('pulse-high-volume-'+i)});
 const capped=await run(node,{range:{fromBlock:from,toBlock:to}}),wide=await run(node,{range:{fromBlock:from,toBlock:to},maxEvents:20});
 assert.equal(capped.events.length,12);assert.equal(capped.counts.filtered.overflow,1);
 assert.equal(wide.events.length,13);assert.equal(wide.counts.filtered.overflow,0);assert.equal(wide.complete,true);
});

test('reorg-aware confirmation: a log whose block hash is no longer canonical is dropped',async()=>{
 const node=ethNode();
 const stale=node.log({address:ETH.UNI,topics:[T('OWNERSHIP_TRANSFERRED'),sim.addr(sim.A(1)),sim.addr(sim.A(2))],block:HEAD-120});
 stale.blockHash=sim.h32('orphaned-block');
 const result=await run(node);
 assert.equal(result.events.length,0);assert.equal(result.counts.reorged,1);assert.equal(result.status,'NO_QUALIFYING_EVENTS');
});

test('events above the confirmed head are pending, and never become a card',async()=>{
 const node=ethNode();
 node.log({address:ETH.GRT,topics:[T('UPGRADED'),sim.addr(sim.A(0x9))],block:HEAD-3});
 const result=await run(node);
 assert.equal(result.events[0].verification,'ONCHAIN_PENDING_CONFIRMATION');assert.equal(result.events[0].confirmation.status,'PENDING');
 assert.equal(onchain.card(result.events[0]),null);assert.deepEqual(onchain.cards(result),[]);
});

test('without a finalized tag the depth threshold is used and declared as an assumption',async()=>{
 const node=ethNode({finalized:null});
 node.log({address:ETH.GRT,topics:[T('UPGRADED'),sim.addr(sim.A(0x9))],block:HEAD-65});
 const result=await run(node);
 assert.equal(result.confirmation.policy,'DEPTH_FALLBACK');assert.equal(result.confirmation.confirmedHead,HEAD-64);
 assert.ok(result.assumptions.some(x=>/not a finality proof/.test(x)));
 assert.equal(result.events[0].confirmation.status,'CONFIRMED');
});

test('a lagging provider head is partial coverage, not a clean result',async()=>{
 const result=await run(ethNode(),{now:NOW+3600000});
 assert.equal(result.status,'PARTIAL_COVERAGE');assert.equal(result.reasonCode,'ONCHAIN_HEAD_STALE');assert.equal(result.head.stale,true);
});

test('logs the provider should not have returned are rejected, and repeated logs are de-duplicated',async()=>{
 const node=ethNode();
 const real=node.log({address:ETH.LINK,topics:[T('ROLE_REVOKED'),sim.h32('MINTER'),sim.addr(sim.A(3)),sim.addr(sim.A(4))],block:HEAD-90});
 const foreign={address:sim.A(0xdead01),topics:[T('OWNERSHIP_TRANSFERRED'),sim.addr(sim.A(1)),sim.addr(sim.A(2))],data:'0x',blockNumber:sim.hex(HEAD-91),blockHash:node.hashOf(HEAD-91),transactionHash:sim.h32('foreign'),logIndex:'0x0'};
 const outOfRange={...real,blockNumber:sim.hex(HEAD-9000000),transactionHash:sim.h32('old')};
 const fetcher=async(url,init)=>{
  const response=await node.fetcher(url,init),body=await response.json();
  for(const item of Array.isArray(body)?body:[body])if(Array.isArray(item?.result)&&item.result.some(l=>l.transactionHash===real.transactionHash))item.result.push(foreign,outOfRange,{...real});
  return new Response(JSON.stringify(body),{status:200});
 };
 const result=await engine.scan({chain:'ethereum',now:NOW,fetcher,urls:URLS});
 assert.equal(result.events.length,1);assert.equal(result.events[0].materiality.level,'MEDIUM');
 assert.equal(result.counts.rejected.EMITTER_NOT_WATCHED,1);assert.equal(result.counts.rejected.OUTSIDE_QUERIED_RANGE,1);assert.equal(result.counts.duplicates,1);
});

test('event ids are deterministic and network-scoped',()=>{
 const tx=sim.h32('x');
 assert.equal(engine.eventId(1,tx,4),engine.eventId(1,tx.toUpperCase().replace('0X','0x'),4));
 assert.notEqual(engine.eventId(1,tx,4),engine.eventId(5042,tx,4));assert.notEqual(engine.eventId(1,tx,4),engine.eventId(1,tx,5));
});

test('Arc and Robinhood use their own scope, factories and explorers',async()=>{
 const arc=watchlist.network('arc'),ARCY=arc.tokens.find(t=>t.symbol==='ARCY').address,LINK=arc.tokens.find(t=>t.symbol==='LINK').address,manager=arc.factories[0].address;
 const node=sim.node({chainId:5042,head:900000,finalized:899990,blockTime:1,genesisTime:GENESIS});
 const poolId=sim.h32('pool');
 node.log({address:manager,topics:[T('V4_INITIALIZE'),poolId,sim.addr(ARCY),sim.addr(LINK)],data:'0x'+[sim.word(3000),sim.word(60),sim.word(0),sim.word(2n**96n),sim.word(0)].map(w=>w.slice(2)).join(''),block:899000});
 // The same event from a contract that is NOT the reviewed pool manager is outside the query and never surfaces.
 node.log({address:sim.A(0xfa4e),topics:[T('V4_INITIALIZE'),poolId,sim.addr(ARCY),sim.addr(LINK)],data:'0x'+sim.word(0).slice(2).repeat(5),block:899001});
 const result=await engine.scan({chain:'arc',now:(GENESIS+900000+20)*1000,fetcher:node.fetcher,urls:URLS});
 assert.equal(result.status,'EVENTS_DETECTED');assert.equal(result.events.length,1);
 assert.equal(result.events[0].details.architecture,'V4_CONCENTRATED');assert.equal(result.events[0].details.poolId,poolId);
 assert.match(result.events[0].evidence.reference,/^https:\/\/explorer\.arc\.io\/tx\/0x/);
 assert.ok(result.cost.rpcCalls<=watchlist.NETWORKS.arc.maxCalls);
 const rh=sim.node({chainId:4663,head:500000,finalized:499900,blockTime:1,genesisTime:GENESIS});
 const quiet=await engine.scan({chain:'robinhood',now:(GENESIS+500000+20)*1000,fetcher:rh.fetcher,urls:URLS});
 assert.equal(quiet.status,'NO_QUALIFYING_EVENTS');assert.ok(!quiet.scope.categories.includes('NEW_POOL'));
 assert.ok(!rh.state.requests.includes('eth_sendRawTransaction'));
 await assert.rejects(()=>engine.scan({chain:'solana'}),{code:'INVALID_PULSE_CHAIN'});
});

test('sparse windows widen the next span up to the reviewed cap; pacing and sequential reads are honoured',async()=>{
 const rh=sim.node({chainId:4663,head:5000000,finalized:4999000,blockTime:1,genesisTime:GENESIS});
 const result=await engine.scan({chain:'robinhood',now:(GENESIS+5000000+5)*1000,fetcher:rh.fetcher,urls:URLS});
 // 2000 + 4000 + 8000 + 16000 + 32000 + 32000 blocks in six windows.
 assert.equal(result.window.windowsRead,6);assert.equal(result.window.blocksCovered,94000);assert.equal(result.complete,true);
 assert.ok(result.window.blocksCovered>=result.window.blocksPlanned);
 // Arc: one call per HTTP request, spaced by the configured pace; the pool query is not split per token position.
 const arcNode=sim.node({chainId:5042,head:900000,finalized:899990,blockTime:1,genesisTime:GENESIS});
 const sent=[],waits=[];
 const fetcher=async(url,init)=>{sent.push(Array.isArray(JSON.parse(init.body)));return arcNode.fetcher(url,init);};
 const arc=await engine.scan({chain:'arc',now:(GENESIS+900000+5)*1000,fetcher,urls:URLS,pace:0});
 assert.equal(arc.status,'NO_QUALIFYING_EVENTS');assert.ok(sent.every(isBatch=>isBatch===false));
 const arcPlan=engine.queries(watchlist.network('arc'),1,2);
 assert.equal(arcPlan.length,6);assert.ok(arcPlan.every(q=>q.filter.topics[0].length<=2),'Arc topic OR-lists stay within the accepted size');
 // Address lists never exceed the provider's per-filter cap, and no watched contract is dropped by the split.
 const eth=watchlist.network('ethereum'),plan=engine.queries(eth,1,2);
 assert.ok(plan.every(q=>q.filter.address.length<=10));
 assert.deepEqual([...new Set(plan.filter(q=>q.kind==='token').flatMap(q=>q.filter.address))].sort(),eth.tokens.map(t=>t.address).sort());
 const paced=transport.create({chainId:5042,urls:URLS,fetcher:arcNode.fetcher,paceMs:280,sleep:async ms=>{waits.push(ms);}});
 await paced.batch([{method:'eth_blockNumber',params:[]},{method:'eth_blockNumber',params:[]}]);
 assert.ok(waits.length>=1&&waits.every(ms=>ms>0&&ms<=280));
});

test('transport is read-only, budgeted, and verifies the chain id of every provider it uses',async()=>{
 const good=sim.node({chainId:1,head:10}),wrong=sim.node({chainId:56,head:10});
 const rpc=transport.create({chainId:1,urls:['https://a.test'],fetcher:good.fetcher,maxCalls:3});
 await assert.rejects(()=>rpc.batch([{method:'eth_sendRawTransaction',params:['0x']}]),{code:'ONCHAIN_METHOD_NOT_ALLOWED'});
 await rpc.batch([{method:'eth_blockNumber',params:[]}]);
 await assert.rejects(()=>rpc.batch([{method:'eth_blockNumber',params:[]},{method:'eth_blockNumber',params:[]}]),{code:'ONCHAIN_RPC_BUDGET_EXHAUSTED'});
 const mismatch=transport.create({chainId:1,urls:['https://wrong.test'],fetcher:wrong.fetcher});
 await assert.rejects(()=>mismatch.batch([{method:'eth_blockNumber',params:[]}]),{code:'ONCHAIN_PROVIDER_UNAVAILABLE',cause:'ONCHAIN_CHAIN_ID_MISMATCH'});
 // Failover: primary down, fallback is chain-checked before use; only the slot label is reported.
 const failover=transport.create({chainId:1,urls:['https://down.test/secret-key','https://up.test'],fetcher:async(url,init)=>url.includes('down')?new Response('{}',{status:429}):good.fetcher(url,init)});
 const [head]=await failover.batch([{method:'eth_blockNumber',params:[]}]);
 assert.equal(head.result,'0xa');assert.equal(failover.cost.failovers,1);
 assert.deepEqual(failover.cost.providerErrors,[{provider:'primary',code:'ONCHAIN_HTTP_429'}]);
 assert.ok(!JSON.stringify(failover.cost).includes('secret-key'));
 // A provider without JSON-RPC batch support is read call by call.
 const single=transport.create({chainId:1,urls:['https://single.test'],fetcher:async(url,init)=>Array.isArray(JSON.parse(init.body))?new Response(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32600,message:'batch requests are not supported'}}),{status:200}):good.fetcher(url,init)});
 const pair=await single.batch([{method:'eth_blockNumber',params:[]},{method:'eth_chainId',params:[]}]);
 assert.deepEqual(pair.map(x=>x.result),['0xa','0x1']);
});

test('entry point: shared in-flight scan, isolated failures, degraded results do not evict a complete one',async()=>{
 onchain.reset();let scans=0;
 const scan=async({chain})=>{scans++;await new Promise(r=>setTimeout(r,5));if(chain==='robinhood')throw Object.assign(Error('x'),{code:'ONCHAIN_PROVIDER_UNAVAILABLE'});return {chain,status:'NO_QUALIFYING_EVENTS',complete:true,events:[],generatedAt:'t1'};};
 const [a,b]=await Promise.all([onchain.get('ethereum',{scan,now:1000}),onchain.get('ethereum',{scan,now:1000})]);
 assert.equal(scans,1);assert.equal(a.status,b.status);
 assert.equal((await onchain.get('ethereum',{scan,now:2000})).cache.hit,true);assert.equal(scans,1);
 const every=await onchain.all({scan,now:3000});
 assert.equal(every.robinhood.status,'PROVIDER_UNAVAILABLE');assert.equal(every.robinhood.reasonCode,'ONCHAIN_PROVIDER_UNAVAILABLE');assert.equal(every.arc.status,'NO_QUALIFYING_EVENTS');
 const failing=async()=>({chain:'ethereum',status:'PROVIDER_UNAVAILABLE',complete:false,reasonCode:'ONCHAIN_PROVIDER_UNAVAILABLE',events:[],generatedAt:'t2'});
 const retained=await onchain.get('ethereum',{scan:failing,now:1000+onchain.TTL_OK+1});
 assert.equal(retained.status,'NO_QUALIFYING_EVENTS');assert.equal(retained.retainedAfter.reasonCode,'ONCHAIN_PROVIDER_UNAVAILABLE');
 // ...but only while the complete result is recent.
 const expired=await onchain.get('ethereum',{scan:failing,now:1000+7*onchain.TTL_OK+2*onchain.TTL_DEGRADED});
 assert.equal(expired.status,'PROVIDER_UNAVAILABLE');
 assert.equal((await onchain.get('arc',{env:{ARC_PULSE_ONCHAIN:'0'}})).status,'DISABLED');
 onchain.reset();
});

test('card mapping fills only non-news slots and keeps the three-card contract',()=>{
 const {withOnchain}=require('../lib/pulse-network-client');
 const event={network:'ethereum',headline:'ONDO: contract owner changed',summary:'Owner changed.',eventTimestamp:'2026-11-10T10:00:00.000Z',verification:'ONCHAIN_CONFIRMED_LOG',
  confirmation:{status:'CONFIRMED'},materiality:{level:'HIGH'},evidence:{reference:'https://etherscan.io/tx/0x'+'a'.repeat(64)},id:'poc1-x',category:'OWNERSHIP_CHANGE',transactionHash:'0x'+'a'.repeat(64)};
 const card=onchain.card(event);
 assert.equal(card.contentType,'ONCHAIN_EVENT');assert.match(card.summary,/Not proven: intent/);assert.match(card.url,/^https:\/\/etherscan\.io\/tx\//);
 assert.equal(onchain.card({...event,materiality:{level:'LOW'}}),null);
 assert.equal(onchain.card({...event,evidence:{reference:'javascript:alert(1)'}}),null);
 const value={cards:[{kind:'week',contentType:'VERIFIED_DEVELOPMENT',title:'news'},{kind:'new',contentType:'SOURCE_GUIDE',title:'guide'},{kind:'unlock',contentType:'SOURCE_GUIDE',title:'guide2'}]};
 const merged=withOnchain(value,[card]);
 assert.equal(merged.cards.length,3);assert.equal(merged.cards[0].title,'news');assert.equal(merged.cards[1].contentType,'ONCHAIN_EVENT');assert.equal(merged.cards[1].kind,'new');
 assert.equal(merged.cards[2].title,'guide2');assert.equal(merged.onchainCards,1);
 assert.equal(withOnchain(value,[]),value);
 const allNews={cards:value.cards.map(c=>({...c,contentType:'VERIFIED_DEVELOPMENT'}))};
 assert.equal(withOnchain(allNews,[card]),allNews);
});

test('watch scope has repository provenance and consistent configuration',()=>{
 const reviewed=new Set([...require('./fixtures/search-v4-contracts.json'),...require('./fixtures/search-v5-contracts.json')].map(([n,,a])=>n+':'+a.toLowerCase()));
 const hints=require('node:fs').readFileSync(require.resolve('../search/server/lib/prefix-catalog.js'),'utf8').toLowerCase();
 for(const chain of Object.keys(watchlist.NETWORKS)){
  const cfg=watchlist.network(chain);
  assert.equal(new Set(cfg.tokens.map(t=>t.address)).size,cfg.tokens.length);
  for(const t of cfg.tokens){assert.match(t.address,/^0x[0-9a-f]{40}$/);assert.ok(reviewed.has(chain+':'+t.address)||hints.includes(t.address),chain+' '+t.symbol+' has no reviewed provenance');}
  for(const f of cfg.factories){assert.match(f.address,/^0x[0-9a-f]{40}$/);assert.match(f.reference,/^https:\/\//);}
  // Worst-case window plan plus fixed overhead always fits the budget.
  const perWindow=engine.queries(cfg,1,2).length;
  assert.ok(3+perWindow*cfg.maxWindows+engine.MAX_EVENTS+4<=cfg.maxCalls,chain+' budget');
 }
 assert.equal(require('../lib/lp-positions').POOL_MANAGER,watchlist.NETWORKS.arc.factories[0].address);
 // Canonical Uniswap mainnet deployments (the live probe additionally requires runtime code at each address).
 assert.deepEqual(watchlist.NETWORKS.ethereum.factories.map(f=>f.address),['0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f','0x1f98431c8ad98523631ae4a59f267346ea31f984','0x000000000004444c5dc75cb358380d2e3de08a90']);
});

test('GET /api/search?action=onchain is additive, read-only and leaves the protected Pulse API untouched',async()=>{
 const handler=require('../api/search/index.js');
 const call=async(url,method='GET')=>{const out={headers:{}};const res={setHeader:(k,v)=>{out.headers[k]=v;},status(n){out.status=n;return res;},json(d){out.body=d;return res;}};await handler({method,url,query:{},headers:{}},res);return out;};
 const prior=process.env.ARC_PULSE_ONCHAIN;process.env.ARC_PULSE_ONCHAIN='0';
 try{
  const one=await call('/api/search?action=onchain&chain=ethereum');
  assert.equal(one.status,200);assert.equal(one.body.ok,true);assert.equal(one.body.status,'DISABLED');assert.equal(one.headers['Cache-Control'],'no-store');
  const every=await call('/api/search?action=onchain');
  assert.deepEqual(Object.keys(every.body.chains).sort(),['arc','ethereum','robinhood']);
  assert.equal((await call('/api/search?action=onchain&chain=ethereum','POST')).status,405);
  assert.equal((await call('/api/search?action=onchain&chain=bsc')).status,400);
  // Unlisted parameters never reach the handler.
  assert.equal((await call('/api/search?action=onchain&chain=arc&limits=x')).body.status,'DISABLED');
 }finally{if(prior===undefined)delete process.env.ARC_PULSE_ONCHAIN;else process.env.ARC_PULSE_ONCHAIN=prior;}
 assert.ok(!require('node:fs').readFileSync(require.resolve('../api/pulse.js'),'utf8').includes('pulse-onchain'));
});
