'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const runtime=require('../lib/verification/runtime');
const evidence=require('../lib/verification/metric-evidence');
const ledger=require('../lib/verification/evidence-ledger');
const observer=require('../lib/verification/onchain-observer');

const NOW=Date.parse('2026-11-12T12:00:00.000Z'),SEC=1000,MIN=60*SEC;
const TOKEN='0x'+'ab'.repeat(20),OWNER='0x'+'cd'.repeat(20),IMPL='0x'+'ef'.repeat(20);
const HASH='0x'+'11'.repeat(32),OTHER_HASH='0x'+'22'.repeat(32),BLOCK='0x64';
const ON='1';
beforeEach(()=>{runtime._resetThrottle();observer._resetHealth();});
const iso=ms=>new Date(ms).toISOString();

// A report with the real Search shape (5 cards x 4 fields), Ethereum style values.
function field(value,source,extra={}){return {value,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',reasonCode:null,reason:null,source,chainId:1,network:'ethereum',evidence:[{block:BLOCK,address:TOKEN}],...extra};}
const missing=code=>({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:code,reason:'x',source:null,evidence:[]});
const market=(value,extra={})=>field(value,'DEX Screener',{freshness:{retrievedAt:iso(NOW-20*SEC),ageMs:20*SEC,basis:'Provider response retrieval time; upstream publication time unavailable.'},evidence:[{pairs:['0xpool']}],...extra});
function report(over={}){
 const r={ok:true,schemaVersion:1,network:'ethereum',chainId:1,address:TOKEN,block:BLOCK,scannedAt:iso(NOW-30*SEC),token:{decimals:18},cards:{
  supply:{fields:{totalSupply:field('0.000000000000001','Ethereum RPC',{status:'ON_CHAIN'}),nonBurnSupply:field('0.000000000000000988','Ethereum RPC',{status:'ON_CHAIN_DERIVED'}),
   burnAddressBalance:field('0.000000000000000012','Ethereum RPC',{status:'ON_CHAIN'}),burnAddressPct:field(1.2,'Ethereum RPC',{status:'ON_CHAIN_DERIVED'})}},
  holders:{fields:{holderCount:field(4321,'Blockscout'),largestWalletPct:field(12.5,'Blockscout candidates + Ethereum RPC'),top10Pct:field(40.25,'Blockscout'),top20Pct:missing('TOP20_NOT_VERIFIED')}},
  liquidity:{fields:{liquidityUsd:market(250000),volume24h:market(12000.5),dexPairCount:market('2 DEX / 3 pairs'),liquidityTurnover24h:market(0.048002)}},
  activity:{fields:{priceUsd:market(0.0123),valuation:market(12300000,{status:'SOURCE_REPORTED_DERIVED'}),change24h:market(-3.5),volume24h:market(12000.5)}},
  mechanics:{fields:{tradingTaxes:field('Buy 0% · Sell 0% · Transfer 0%','Sourcify'),mintCapability:field('No mint function','Sourcify'),
   ownerAdmin:field('owner() getter: '+OWNER,'Ethereum RPC',{status:'ON_CHAIN'}),contractArchitecture:field('EIP-1967 implementation: '+IMPL,'Ethereum RPC',{status:'ON_CHAIN'})}}}};
 return Object.assign(r,over);
}
// Observer output in the exact shape lib/verification/onchain-observer.js returns.
function endpoint(role,operator,o={}){
 const readings=o.readings===null?{}:{chainId:1,header:{hash:o.hash||HASH,timestamp:Math.floor((o.blockTime??NOW-60*SEC)/1000)},totalSupply:o.supply??'1000',decimals:18,
  burn0:'5',burn1:'7',burnBalance:o.burn??'12',owner:o.owner??OWNER,implementation:IMPL,...(role==='primary'?{head:o.head??'101'}:{})};
 return {role,providerId:'verify-ethereum-'+operator,operator,operatorBasis:o.basis||'REGISTRY',operatorReference:null,state:o.state||'OK',reasonCode:o.reasonCode||null,
  readings,errors:o.errors||{},cost:{rpcCalls:o.state==='SKIPPED'?0:8,ms:40},watchdogState:o.watchdog||'HEALTHY'};
}
function fakeObserve({primary={},independent={},independence={independent:true,reasonCode:null},only}={}){
 const calls=[];
 const fn=async args=>{calls.push(args);const list=[endpoint('primary','allnodes',primary)];if(!only)list.push(endpoint('independent','drpc',independent));
  return {network:args.network,chainId:1,block:{hex:args.block,number:BigInt(args.block).toString()},independence,endpoints:list,cost:{rpcCalls:list.reduce((n,e)=>n+e.cost.rpcCalls,0),ms:80,deadlineMs:4000},healthPersistence:'PROCESS_LOCAL'};};
 fn.calls=calls;return fn;
}
const verify=(r,o={})=>runtime.verify(r,{network:'ethereum',env:{},now:()=>NOW,observe:fakeObserve(),...o});
const m=(v,id)=>v.metrics[id];

test('flag OFF: the report object and its JSON are returned untouched',async()=>{
 const r=report(),before=JSON.stringify(r);let called=0;
 const out=await runtime.annotateIfEnabled(r,{network:'ethereum',env:{},observe:async()=>{called++;}});
 assert.equal(out,r);assert.equal(JSON.stringify(out),before);assert.equal('verification' in out,false);assert.equal(called,0);
 for(const v of ['0','true','yes',''])assert.equal(runtime.enabled({ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED:v}),false,v);
 assert.equal(runtime.enabled({ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED:'1'}),true);
});

test('flag ON: one additive object; every card, field, value and status is unchanged',async()=>{
 const r=report(),cards=JSON.stringify(r.cards),keys=Object.keys(r);
 await runtime.annotateIfEnabled(r,{network:'ethereum',env:{ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED:ON},now:()=>NOW,observe:fakeObserve()});
 assert.equal(JSON.stringify(r.cards),cards);assert.deepEqual(Object.keys(r),[...keys,'verification']);
 assert.equal(r.verification.state,'COMPLETE');assert.equal(r.verification.metricCount,20);
});

test('two registered operators agree at the same block: on-chain supply, burn and controls are VERIFIED_ONCHAIN',async()=>{
 const v=await verify(report());
 for(const id of ['supply.total_supply','supply.burn_address_balance','supply.non_burn_supply','supply.burn_address_pct','mechanics.owner_admin','mechanics.contract_architecture']){
  const row=m(v,id);
  assert.equal(row.state,'VERIFIED_ONCHAIN',id+' '+row.reasonCode);assert.equal(row.verified,true);
  assert.equal(row.evidence.reasonCode,'EXACT_ONCHAIN_AGREEMENT');assert.deepEqual(row.evidence.block,{number:'100',hash:HASH});
  assert.deepEqual(new Set(row.evidence.observations.map(o=>o.source.operator)),new Set(['allnodes','drpc']));
  assert.equal(row.freshness.state,'FRESH');assert.equal(row.display.matches,true);
 }
 assert.equal(m(v,'supply.total_supply').evidence.value,'1000');assert.equal(m(v,'supply.total_supply').evidence.unit,'token-base-units');
 assert.equal(m(v,'supply.burn_address_pct').evidence.value,'1.2');
 assert.equal(m(v,'mechanics.owner_admin').evidence.value,OWNER);
 assert.equal(v.verifiedCount,6);assert.equal(v.block.hash,HASH);assert.equal(v.independence.independent,true);
 // Every published record satisfies the strict MetricEvidence contract.
 for(const row of Object.values(v.metrics))assert.doesNotThrow(()=>evidence.parseMetricEvidence(row.evidence),row.evidence.metricId);
});

test('market values: no provider timestamp means SOURCE_AGE_UNKNOWN and SINGLE_SOURCE, never VERIFIED',async()=>{
 const v=await verify(report());
 for(const id of ['liquidity.liquidity_usd','liquidity.volume_24h','activity.price_usd','activity.volume_24h']){
  const row=m(v,id);
  assert.equal(row.state,'SINGLE_SOURCE');assert.equal(row.verified,false);assert.equal(row.reasonCode,'SOURCE_AGE_UNKNOWN');
  assert.equal(row.freshness.state,'SOURCE_AGE_UNKNOWN');assert.equal(row.consensus.reasonCode,'MARKET_CROSSCHECK_NOT_ENABLED');
  assert.equal(row.evidence.source.operator,'dexscreener');assert.equal(row.evidence.observedAt,iso(NOW-20*SEC));
 }
 assert.equal(m(v,'activity.price_usd').evidence.value,'0.0123');
 // Derived FDV is never verified, even though its supply input is on-chain.
 assert.equal(m(v,'activity.valuation').state,'SINGLE_SOURCE');assert.equal(m(v,'activity.valuation').reasonCode,'DERIVED_FROM_MARKET_INPUT');
 assert.equal(m(v,'liquidity.turnover_24h').reasonCode,'DERIVED_FROM_MARKET_INPUT');
 // A textual display value is attested by its hash, not rewritten.
 const pairs=m(v,'liquidity.dex_pair_count').evidence;assert.equal(pairs.unit,'text-sha256');assert.match(pairs.value,/^0x[0-9a-f]{64}$/);
});

test('market cross-check: tolerance agreement keeps both raw values but stays SINGLE_SOURCE; disagreement is CONFLICTING',async()=>{
 const cc=(state,a,b)=>({crossCheck:{state,providers:['DEX Screener','GeckoTerminal'],values:{'DEX Screener':a,GeckoTerminal:b},checkedAt:iso(NOW-20*SEC)}});
 const r=report();
 r.cards.activity.fields.priceUsd=market(0.0123,cc('AGREE',0.0123,0.0121));             // 1.6 %: inside 3 %
 r.cards.activity.fields.volume24h=market(12000.5,cc('DISAGREE',12000.5,5000));         // far apart
 r.cards.liquidity.fields.volume24h=market(12000.5,cc('SCOPE_MISMATCH',12000.5,11900));
 // 14 % apart: inside the generic 25 % consensus preset, outside the 10 % liquidity tolerance users already see.
 r.cards.liquidity.fields.liquidityUsd=market(250000,cc('DISAGREE',250000,215000));
 const v=await verify(r);
 const agree=m(v,'activity.price_usd');
 assert.equal(agree.state,'SINGLE_SOURCE');assert.equal(agree.reasonCode,'WITHIN_TOLERANCE_NOT_EXACT');
 assert.equal(agree.consensus.state,'AGREED');assert.deepEqual(agree.consensus.values,[{operator:'dexscreener',value:'0.0123'},{operator:'coingecko',value:'0.0121'}]);
 assert.equal(agree.evidence.observations.length,1,'the second value is kept in consensus, not merged into the evidence as agreement');
 const conflict=m(v,'activity.volume_24h');
 assert.equal(conflict.state,'CONFLICTING');assert.equal(conflict.evidence.value,null);
 assert.deepEqual(conflict.evidence.observations.map(o=>o.value),['12000.5','5000']);
 assert.equal(conflict.evidence.disagreement.kind,'VALUE_MISMATCH');
 assert.equal(m(v,'liquidity.volume_24h').reasonCode,'POOL_COVERAGE_MISMATCH');
 const strict=m(v,'liquidity.liquidity_usd');
 assert.equal(strict.state,'CONFLICTING');assert.equal(strict.consensus.policy,'market-liquidity-usd-v1.strict');
});

test('operators that disagree on the value or on the block hash produce CONFLICTING, never a chosen value',async()=>{
 const value=await verify(report(),{observe:fakeObserve({independent:{supply:'999'}})});
 const row=m(value,'supply.total_supply');
 assert.equal(row.state,'CONFLICTING');assert.equal(row.evidence.disagreement.kind,'VALUE_MISMATCH');assert.equal(row.evidence.value,null);
 assert.deepEqual(row.consensus.values.map(x=>x.value),['1000','999']);
 const fork=await verify(report(),{observe:fakeObserve({independent:{hash:OTHER_HASH}})});
 assert.equal(m(fork,'supply.total_supply').state,'CONFLICTING');assert.equal(m(fork,'supply.total_supply').reasonCode,'BLOCK_HASH_MISMATCH');
 assert.equal(m(fork,'supply.total_supply').evidence.disagreement.kind,'BLOCK_HASH_MISMATCH');
});

test('the displayed value must equal what the operators read',async()=>{
 const r=report();r.cards.supply.fields.totalSupply=field('0.000000000000002','Ethereum RPC',{status:'ON_CHAIN'});
 const row=m(await verify(r),'supply.total_supply');
 assert.equal(row.state,'NOT_VERIFIED');assert.equal(row.reasonCode,'DISPLAYED_VALUE_MISMATCH');assert.equal(row.display.matches,false);
 // A field the card does not display is not "verified" behind the user's back.
 const hidden=report();hidden.cards.supply.fields.burnAddressBalance=missing('BURN_BALANCE_READ_FAILED');
 assert.equal(m(await verify(hidden),'supply.burn_address_balance').reasonCode,'FIELD_NOT_DISPLAYED');
 // ownerAdmin that is not an owner() getter result is not checked by RPC at all.
 const roles=report();roles.cards.mechanics.fields.ownerAdmin=field('AccessControl: DEFAULT_ADMIN_ROLE held by 1 account','Arc RPC / Sourcify');
 const o=fakeObserve(),v=await verify(roles,{observe:o});
 assert.equal(o.calls[0].wants.owner,false);assert.equal(m(v,'mechanics.owner_admin').state,'SINGLE_SOURCE');assert.equal(m(v,'mechanics.owner_admin').evidence.unit,'text-sha256');
});

test('no independent operator: same operator, unverified operator, cooldown or failure all stay SINGLE_SOURCE',async()=>{
 const same=await verify(report(),{observe:fakeObserve({only:true,independence:{independent:false,reasonCode:'SAME_OPERATOR'}})});
 assert.equal(m(same,'supply.total_supply').state,'SINGLE_SOURCE');assert.equal(m(same,'supply.total_supply').reasonCode,'SAME_OPERATOR');
 const unverified=await verify(report(),{observe:fakeObserve({independence:{independent:false,reasonCode:'OPERATOR_UNVERIFIED'},independent:{basis:'DOMAIN_FALLBACK'}})});
 assert.equal(m(unverified,'supply.total_supply').reasonCode,'OPERATOR_INDEPENDENCE_UNVERIFIED');
 assert.equal(m(unverified,'supply.total_supply').evidence.observations.length,1);
 const cool=await verify(report(),{observe:fakeObserve({independent:{state:'SKIPPED',reasonCode:'PROVIDER_COOLDOWN',readings:null,watchdog:'COOLDOWN'}})});
 assert.equal(m(cool,'supply.total_supply').reasonCode,'INDEPENDENT_PROVIDER_COOLDOWN');
 const down=await verify(report(),{observe:fakeObserve({independent:{state:'FAILED',reasonCode:'RPC_TIMEOUT',readings:null,errors:{chainId:'RPC_TIMEOUT'}}})});
 assert.equal(m(down,'supply.total_supply').reasonCode,'INDEPENDENT_READ_FAILED');
 // Primary down, independent up: still one operator.
 const primaryDown=await verify(report(),{observe:fakeObserve({primary:{state:'FAILED',readings:null}})});
 assert.equal(m(primaryDown,'supply.total_supply').state,'SINGLE_SOURCE');assert.equal(m(primaryDown,'supply.total_supply').evidence.source.operator,'drpc');
 // Observer throws: on-chain metrics are UNAVAILABLE; the report itself is still served.
 const broken=await verify(report(),{observe:async()=>{throw Object.assign(Error('x'),{code:'VERIFICATION_INVALID_BLOCK'});}});
 assert.equal(m(broken,'supply.total_supply').state,'UNAVAILABLE');assert.equal(m(broken,'supply.total_supply').reasonCode,'VERIFICATION_INVALID_BLOCK');
});

test('stale, future and inconsistent anchors: STALE carries no current value; invalid times are NOT_VERIFIED',async()=>{
 const stale=await verify(report(),{observe:fakeObserve({primary:{blockTime:NOW-20*MIN},independent:{blockTime:NOW-20*MIN}})});
 const row=m(stale,'supply.total_supply');
 assert.equal(row.state,'STALE');assert.equal(row.evidence.value,null);assert.equal(row.reasonCode,'BLOCK_OLDER_THAN_POLICY');
 assert.equal(row.verified,false);assert.equal(row.evidence.observations.length,2);
 // 20 minutes is still current for contract mechanics (6 h policy).
 assert.equal(m(stale,'mechanics.owner_admin').state,'VERIFIED_ONCHAIN');
 const future=await verify(report(),{observe:fakeObserve({primary:{blockTime:NOW+10*MIN},independent:{blockTime:NOW+10*MIN}})});
 assert.equal(m(future,'supply.total_supply').reasonCode,'BLOCK_TIMESTAMP_IN_FUTURE');
 const ahead=await verify(report(),{observe:fakeObserve({primary:{head:'50'}})});
 assert.equal(m(ahead,'supply.total_supply').reasonCode,'BLOCK_AHEAD_OF_HEAD');
 // A cached market response retrieved 10 minutes ago is stale even without a provider timestamp.
 const old=report();old.cards.activity.fields.priceUsd=market(0.0123,{freshness:{retrievedAt:iso(NOW-10*MIN)}});
 const price=m(await verify(old),'activity.price_usd');assert.equal(price.state,'STALE');assert.equal(price.reasonCode,'RETRIEVAL_OLDER_THAN_POLICY');assert.equal(price.evidence.value,null);
 const badTime=report();badTime.cards.activity.fields.priceUsd=market(0.0123,{freshness:{retrievedAt:'not a time'}});
 assert.equal(m(await verify(badTime),'activity.price_usd').state,'NOT_VERIFIED');
});

test('invalid report input becomes an explicit FAILED sidecar, never a thrown request',async()=>{
 const r={ok:true,network:'ethereum',address:'nope',cards:{}};
 await runtime.annotateIfEnabled(r,{network:'ethereum',env:{ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED:ON},observe:fakeObserve()});
 assert.equal(r.verification.state,'FAILED');assert.equal(r.verification.reasonCode,'VERIFICATION_REPORT_INVALID');assert.deepEqual(r.verification.metrics,{});
});

test('network isolation: an Arc report is observed on Arc and its evidence is bound to chain 5042',async()=>{
 const r=report({network:'arc',chainId:5042});
 for(const c of Object.values(r.cards))for(const f of Object.values(c.fields))if(f.dataState==='DATA_FOUND'){f.network='arc';f.chainId=5042;}
 const o=fakeObserve(),v=await runtime.verify(r,{network:'arc',env:{},now:()=>NOW,observe:o});
 assert.equal(o.calls[0].network,'arc');assert.equal(v.chainId,5042);
 for(const row of Object.values(v.metrics)){assert.equal(row.evidence.network,'arc');for(const ob of row.evidence.observations)assert.equal(ob.chainId,5042);}
});

test('without durable storage the runtime says history is NOT_PRESERVED',async()=>{
 const v=await verify(report());
 assert.equal(v.ledger.state,'UNAVAILABLE');assert.equal(v.ledger.reasonCode,'EVIDENCE_LEDGER_STORAGE_UNCONFIGURED');assert.equal(v.ledger.history,'NOT_PRESERVED');
 assert.ok(Object.values(v.metrics).every(row=>row.change.kind==='HISTORY_UNAVAILABLE'&&row.history===null));
});

async function withLedger(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-verify-ledger-'));try{await fn({ARC_VERIFICATION_LEDGER_DIR:dir},dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}

test('durable ledger: first observation, unchanged, genuine value change, stale reading and restart persistence',()=>withLedger(async env=>{
 const run=(at,o)=>runtime.verify(report(),{network:'ethereum',env,now:()=>at,observe:fakeObserve(o)});
 const first=await run(NOW,{});
 assert.equal(first.ledger.state,'RECORDED');assert.equal(first.ledger.written,20);
 assert.equal(m(first,'supply.total_supply').change.kind,'FIRST_OBSERVATION');
 const second=await run(NOW+2*MIN,{primary:{blockTime:NOW+MIN},independent:{blockTime:NOW+MIN}});
 assert.equal(m(second,'supply.total_supply').change.kind,'UNCHANGED');
 assert.equal(m(second,'supply.total_supply').history.historical,true);
 // Supply really changed on chain (both operators agree on the new value): a genuine value change.
 const r=report();r.cards.supply.fields.totalSupply=field('0.000000000000002','Ethereum RPC',{status:'ON_CHAIN'});
 const changed=await runtime.verify(r,{network:'ethereum',env,now:()=>NOW+4*MIN,observe:fakeObserve({primary:{supply:'2000',blockTime:NOW+3*MIN},independent:{supply:'2000',blockTime:NOW+3*MIN}})});
 assert.deepEqual(m(changed,'supply.total_supply').change,{kind:'VALUE_CHANGED',from:'1000',to:'2000',fromBlock:'100',toBlock:'100',lastTrustedAt:iso(NOW+MIN)});
 // The independent provider is down: no current trusted reading. The last trusted value is HISTORY, not today's value.
 runtime._resetThrottle();
 const later=await run(NOW+6*MIN,{independent:{state:'SKIPPED',reasonCode:'PROVIDER_COOLDOWN',readings:null},primary:{supply:'2000',blockTime:NOW+5*MIN}});
 const row=m(later,'supply.total_supply');
 assert.equal(row.state,'NOT_VERIFIED','displayed value 0.000000000000001 no longer matches the 2000 read');
 const cool=report();cool.cards.supply.fields.totalSupply=field('0.000000000000002','Ethereum RPC',{status:'ON_CHAIN'});
 const reduced=await runtime.verify(cool,{network:'ethereum',env,now:()=>NOW+8*MIN,observe:fakeObserve({independent:{state:'SKIPPED',reasonCode:'PROVIDER_COOLDOWN',readings:null},primary:{supply:'2000',blockTime:NOW+7*MIN}})});
 const r2=m(reduced,'supply.total_supply');
 assert.equal(r2.state,'SINGLE_SOURCE');assert.equal(r2.change.kind,'UNVERIFIED_OBSERVATION');
 assert.deepEqual({h:r2.history.historical,v:r2.history.value,state:r2.history.state},{h:true,v:'2000',state:'VERIFIED_ONCHAIN'});
 assert.notEqual(r2.history.observedAt,r2.evidence.observedAt);
 const stale=await run(NOW+40*MIN,{primary:{blockTime:NOW+10*MIN,supply:'2000'},independent:{blockTime:NOW+10*MIN,supply:'2000'}});
 assert.equal(m(stale,'supply.burn_address_balance').change.kind,'NO_CURRENT_TRUSTED_READING');
 // Restart: process memory is gone; the ledger still has the history and the record is valid.
 runtime._resetThrottle();
 const disk=await ledger.read({metricId:'supply.total_supply',network:'ethereum',token:TOKEN,scope:null},{env});
 assert.equal(disk.lastTrusted.value,'2000');assert.equal(disk.previousTrusted.value,'1000');assert.ok(disk.transitions.length>=3);
 assert.ok(ledger.validRecord(disk,{metricId:'supply.total_supply',network:'ethereum',token:TOKEN,scope:null}));
}));

test('ledger safety: corrupt records fail closed, out-of-order writes are rejected, identical rereads are throttled',()=>withLedger(async(env,dir)=>{
 await runtime.verify(report(),{network:'ethereum',env,now:()=>NOW,observe:fakeObserve()});
 const throttled=await runtime.verify(report(),{network:'ethereum',env,now:()=>NOW+10*SEC,observe:fakeObserve()});
 assert.equal(throttled.ledger.written,0);assert.equal(throttled.ledger.throttled,20);
 // Out of order: an older analysis arriving after a newer one is never written over it.
 runtime._resetThrottle();
 const older=await runtime.verify(report(),{network:'ethereum',env,now:()=>NOW-MIN,observe:fakeObserve()});
 assert.equal(m(older,'supply.total_supply').ledger.state,'OUT_OF_ORDER_REJECTED');assert.equal(older.ledger.state,'FAILED');
 // Corrupt file: read fails closed, history is reported unavailable and the file is not replaced.
 const file=ledger.fileFor({metricId:'supply.total_supply',network:'ethereum',token:TOKEN,scope:null},env);
 await fs.writeFile(file,'{"broken":');
 runtime._resetThrottle();
 const after=await runtime.verify(report(),{network:'ethereum',env,now:()=>NOW+5*MIN,observe:fakeObserve({primary:{blockTime:NOW+4*MIN},independent:{blockTime:NOW+4*MIN}})});
 const row=m(after,'supply.total_supply');
 assert.equal(row.change.kind,'HISTORY_UNAVAILABLE');assert.equal(row.ledger.reasonCode,'EVIDENCE_LEDGER_CORRUPT');
 assert.equal(await fs.readFile(file,'utf8'),'{"broken":');
 assert.equal(row.state,'VERIFIED_ONCHAIN','a broken history never changes the current verification');
 assert.equal(after.ledger.state,'PARTIAL');
}));

test('concurrent analyses of the same token serialise on the ledger and leave valid records',()=>withLedger(async env=>{
 const times=[NOW,NOW+MIN,NOW+2*MIN,NOW+3*MIN];
 const results=await Promise.all(times.map(t=>runtime.verify(report(),{network:'ethereum',env,now:()=>t,
  observe:fakeObserve({primary:{blockTime:t-30*SEC},independent:{blockTime:t-30*SEC}})})));
 const states=results.map(v=>m(v,'supply.total_supply').ledger.state);
 assert.ok(states.every(s=>['RECORDED','OUT_OF_ORDER_REJECTED','THROTTLED'].includes(s)),states.join());
 const id={metricId:'supply.total_supply',network:'ethereum',token:TOKEN,scope:null},disk=await ledger.read(id,{env});
 assert.ok(ledger.validRecord(disk,id));
 assert.ok(disk.revision>=1&&disk.revision<=4);
 const files=await fs.readdir(env.ARC_VERIFICATION_LEDGER_DIR);
 assert.ok(!files.some(f=>f.endsWith('.tmp')||f.endsWith('.lock')),files.join());
}));

test('end to end through the real observer with a fake network: bounded calls and real contract records',async()=>{
 const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0'),addr=a=>'0x'+a.slice(2).padStart(64,'0');
 let calls=0;
 const fetcher=async(url,init)=>{calls++;const q=JSON.parse(init.body),ok=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  if(q.method==='eth_chainId')return ok('0x1');if(q.method==='eth_blockNumber')return ok('0x65');
  if(q.method==='eth_getBlockByNumber')return ok({number:q.params[0],hash:HASH,timestamp:'0x'+Math.floor((NOW-MIN)/1000).toString(16)});
  if(q.method==='eth_getStorageAt')return ok(addr(IMPL));
  const d=q.params[0].data;return ok(d==='0x18160ddd'?word(1000):d==='0x313ce567'?word(18):d==='0x8da5cb5b'?addr(OWNER):word(d.endsWith('dead')?7:5));};
 const v=await runtime.verify(report(),{network:'ethereum',env:{},now:()=>NOW,fetcher});
 assert.equal(m(v,'supply.total_supply').state,'VERIFIED_ONCHAIN');assert.equal(v.verifiedCount,6);
 assert.equal(v.budget.rpcCalls,calls);assert.ok(calls<=18,String(calls));
 assert.deepEqual(v.providers.map(p=>[p.role,p.operator]),[['primary','allnodes'],['independent','drpc']]);
});

test('the Search report builder calls the runtime after the existing annotators and keys its cache on the flag',()=>{
 const text=require('node:fs').readFileSync(path.join(__dirname,'..','search','server','lib','multichain-service.js'),'utf8');
 const a=text.indexOf("require('./evidence-class').annotate(result)"),b=text.indexOf("require('../../../lib/verification/runtime').annotateIfEnabled(result,{network})");
 assert.ok(a>0&&b>a);
 assert.match(text,/'ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED'\]\.map\(k=>process\.env\[k\]\|\|''\)/);
});
