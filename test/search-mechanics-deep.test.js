'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../search/server/lib/mechanics-deep'),{createReader}=require('../search/server/lib/source-request');
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),C='0x'+'3'.repeat(40),block='0x1234';
const zero='0x'+'0'.repeat(64),word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0'),addr=a=>'0x'+a.slice(2).padStart(64,'0');
const basic='0x600160005500',delegate='0x60006000f400';
function fixture({code=basic,slots={},calls={},targets={},source=null}={}){
 const seen=[];const rpc=async(method,p)=>{seen.push([method,p]);assert.equal(p[p.length-1],block);if(method==='eth_getCode')return p[0]===A?code:targets[p[0]]||'0x';if(method==='eth_getStorageAt')return slots[p[1]]||zero;if(method==='eth_call'){const key=p[0].to+':'+p[0].data;const v=calls[key]??calls[p[0].data];if(v instanceof Error)throw v;return v||zero;}throw Error('Unexpected method');};
 return {seen,options:{network:'ethereum',address:A,block,rpc,sourceLoader:async()=>source}};
}
function fn(name,inputs=[],type='address'){return {type:'function',name,stateMutability:'view',inputs:inputs.map(type=>({type})),outputs:[{type}]};}
const profile=id=>Object.keys(m.PROFILES).find(k=>m.PROFILES[k]===id);

test('reviewed one-shot reward launch source establishes only transfer tax; initialized portal is required for no further mint',async()=>{
 for(const initialized of [false,true]){const source={digest:profile('INITIALIZED_REWARD_LAUNCH_TOKEN'),abi:[fn('owner'),fn('portal')],url:'https://sourcify.dev/exact-source'},x=fixture({source,calls:{[m.selector('owner()')]:addr(B),[m.selector('portal()')]:initialized?addr(C):zero}}),r=await m.inspect(x.options);assert.match(r.fields.tradingTaxes.value,/Transfer 0%/);assert.match(r.fields.tradingTaxes.value,/DEX\/hook fees NOT VERIFIED/);assert.equal(r.fields.tradingTaxes.evidence[0].coverage,'TOKEN_TRANSFER_ONLY');assert.equal(Boolean(r.fields.mintCapability),initialized);assert(r.details.observations.some(x=>x.burn?.includes('dead address is an ordinary holder')));}
});
test('second complete reviewed legacy source binds implementation/admin; unrelated source and invalid target do not',async()=>{
 const cloneSource={digest:'316b86e4d73ad7a683188f2ac85162c763fd055d47d44c2be790d54b83a73a49',abi:[]},implementation={digest:'d8d6edfc12f71433b5efe6ab623af4db5b160750902daa4f08fe337865087ceb',abi:[]},x=fixture({code:delegate,slots:{[m.SLOTS.legacy]:addr(B),[m.SLOTS.legacyAdmin]:addr(C)},targets:{[B]:basic},calls:{[m.selector('masterMinter()')]:addr(C)}});x.options.sourceLoader=async(cfg,a)=>a===A?cloneSource:implementation;const r=await m.inspect(x.options);assert.match(r.fields.contractArchitecture.value,/Legacy implementation/);assert.equal(r.fields.contractArchitecture.evidence[0].implementation,B);assert.match(r.fields.ownerAdmin.value,/Proxy admin/);assert.match(r.fields.ownerAdmin.evidence[0].method,/legacy/i);assert.match(r.fields.mintCapability.value,/Allowance-limited/);assert(r.details.observations.some(x=>x.burn?.includes('totalSupply')));
});
test('unknown fields retain source-failure evidence instead of silently dropping diagnostics',async()=>{
 const x=fixture(),card={fields:{tradingTaxes:{value:null,dataState:'NOT_VERIFIED',reason:'Tax semantics unknown',evidence:[]}}};x.options.sourceLoader=async(cfg,a,c,failures)=>{failures.push({reason:'SOURCE_API_FAILED',chainId:cfg.chainId,address:a});return null};const result=await m.enrich({...x.options,card});assert.equal(result.fields.tradingTaxes.value,null);assert.equal(result.fields.tradingTaxes.dataState,'NOT_VERIFIED');assert(result.fields.tradingTaxes.evidence.some(x=>x.failures?.some(f=>f.reason==='SOURCE_API_FAILED')));
});
test('source identity, bytecode, malformed ABI and unrelated source fail closed',()=>{
 const d={chainId:'1',address:A,runtimeMatch:'exact_match',runtimeBytecode:{onchainBytecode:basic},abi:[],sources:{'x.sol':{content:'original'}}};
 const args={chainId:1,address:A,code:basic};assert.ok(m.validateSource(d,args).digest);
 for(const changed of [{chainId:5042},{address:B},{runtimeMatch:'creation_match'},{runtimeBytecode:{onchainBytecode:delegate}},{abi:null},{abi:[null]},{abi:[{type:'function',name:'mint',inputs:{},outputs:[]}]},{sources:{x:{content:12}}}])assert.throws(()=>m.validateSource({...d,...changed},args));
 assert.notEqual(m.digest(d.sources),m.digest({'x.sol':{content:'modified'}}));
});
test('strict canonical address padding rejects uint masquerading as address',()=>{
 for(const reader of [require('../search/server/lib/control').addrWord,require('../search/server/lib/arc-adapter').addressWord,require('../search/server/lib/robinhood-adapter').addressOf]){assert.equal(reader('0x'+'f'.repeat(24)+A.slice(2)),null);assert.equal(reader(addr(A)),A);assert.equal(reader(zero),null);}
});
test('conservative runtime proof keeps metadata/PUSH semantics and rejects EOF/truncation',async()=>{
 for(const [code,valid]of [[basic,true],['0x60f400',true],['0x5bf4',false],['0x61ff',false],['0xef0001',false]]){const x=fixture({code});const r=await m.inspect(x.options);assert.equal(Boolean(r.fields.contractArchitecture),valid);}
});
test('exact clones require target deployed at same block; no genesis/index calls',async()=>{
 const code='0x363d3d373d3d3d363d73'+B.slice(2)+'5af43d82803e903d91602b57fd5bf3';
 for(const deployed of [false,true]){const x=fixture({code,targets:deployed?{[B]:basic}:{}});const r=await m.inspect(x.options);assert.equal(Boolean(r.fields.contractArchitecture),deployed);if(deployed)assert.equal(r.fields.contractArchitecture.evidence[0].implementation,B);assert.ok(x.seen.every(([n])=>!n.includes('Logs')));}
});
test('EIP1967 slot must point to real bytecode; high bits/self/empty target rejected',async()=>{
 for(const value of [addr(B),'0x'+'f'.repeat(24)+B.slice(2),addr(A)]){const x=fixture({code:delegate,slots:{[m.SLOTS.implementation]:value},targets:{[B]:basic}});const r=await m.inspect(x.options);assert.equal(r.fields.contractArchitecture,undefined);assert.equal(r.fields.ownerAdmin,undefined);}
});
test('legacy proxy and beacon targets are pinned, never inferred from ABI name',async()=>{
 const x=fixture({code:delegate,slots:{[m.SLOTS.legacy]:addr(B)},targets:{[B]:basic}});assert.equal((await m.inspect(x.options)).fields.contractArchitecture,undefined);
 const b=fixture({code:delegate,slots:{[m.SLOTS.beacon]:addr(B)},calls:{[B+':'+m.selector('implementation()')]:addr(C)},targets:{[B]:basic,[C]:basic}});assert.equal((await m.inspect(b.options)).fields.contractArchitecture,undefined);
});
test('nondelegating runtime does not turn arbitrary storage into proxy/admin authority',async()=>{
 const x=fixture({slots:{[m.SLOTS.implementation]:addr(B),[m.SLOTS.admin]:addr(C)},targets:{[B]:basic}});const r=await m.inspect(x.options);assert.match(r.fields.contractArchitecture.value,/NON-PROXY/);assert.equal(r.fields.ownerAdmin,undefined);
});
test('unreviewed delegating outer source cannot borrow implementation fee semantics',async()=>{
 const x=fixture({code:delegate,slots:{[m.SLOTS.implementation]:addr(B)},targets:{[B]:basic},source:{digest:profile('WARD_AUTH_TOKEN'),abi:[]}});const r=await m.inspect(x.options);assert.equal(r.fields.tradingTaxes,undefined);assert.ok(r.details.failures.some(x=>x.reason==='IMPLEMENTATION_EXECUTION_UNRESOLVED'));
});
test('verified ABI with mint selector alone never establishes mint/tax capability',async()=>{
 const x=fixture({source:{abi:[{type:'function',name:'mint',stateMutability:'nonpayable',inputs:[],outputs:[]}],digest:'unreviewed'}});const r=await m.inspect(x.options);assert.equal(r.fields.mintCapability,undefined);assert.equal(r.fields.tradingTaxes,undefined);assert.equal(r.details.interfaceCandidates[0].status,'INTERFACE_ONLY');
});
test('ABI zero owner cannot establish absence of all privileges',async()=>{
 const x=fixture({source:{abi:[fn('owner')],digest:'unreviewed'}});assert.equal((await m.inspect(x.options)).fields.ownerAdmin,undefined);
});
test('reviewed capped fee path uses active bps AND cap, preserves mutations and forwarding uncertainty',async()=>{
 const source={digest:profile('CAPPED_FEE_LEGACY_TOKEN'),abi:[]};
 for(const[bps,cap,deprecated,expected]of [[10,10000,0,'0.1%'],[10,0,0,'0%'],[20,10,0,null],[0,10,1,null]]){const x=fixture({source,calls:{[m.selector('basisPointsRate()')]:word(bps),[m.selector('maximumFee()')]:word(cap),[m.selector('deprecated()')]:word(deprecated),[m.selector('owner()')]:addr(B)}});const r=await m.inspect(x.options);if(expected){assert.ok(r.fields.tradingTaxes.value.includes(expected));assert.equal(r.fields.tradingTaxes.evidence[0].mutable,true);assert.match(r.fields.tradingTaxes.value,/DEX\/hook fees NOT VERIFIED/);}else assert.equal(r.fields.tradingTaxes,undefined);}
});
test('fee getter failure and false simulation cannot erase stronger reviewed result',async()=>{
 const x=fixture({source:{digest:profile('WARD_AUTH_TOKEN'),abi:[]}});const card={fields:{tradingTaxes:{value:'Provider 99%',status:'SOURCE_REPORTED',dataState:'DATA_FOUND',evidence:[{source:'secondary provider',block:'0x100'}]}}};const r=await m.enrich({...x.options,card});assert.match(r.fields.tradingTaxes.value,/Transfer 0%/);assert.equal(r.fields.tradingTaxes.status,'VERIFIED_SOURCE');assert.ok(r.fields.tradingTaxes.evidence.some(e=>e.source==='secondary provider'&&e.block==='0x100'&&e.retainedFrom));
 const fail=fixture({source:{digest:profile('CAPPED_FEE_LEGACY_TOKEN'),abi:[]},calls:{[m.selector('basisPointsRate()')]:Error('429')}});assert.equal((await m.inspect(fail.options)).fields.tradingTaxes,undefined);
});
test('reviewed timed mint requires pinned nonzero minter and stores limits without claiming execution',async()=>{
 const x=fixture({source:{digest:profile('TIMED_CAPPED_MINTER'),abi:[]},calls:{[m.selector('minter()')]:addr(B),[m.selector('mintCap()')]:word(2),[m.selector('mintingAllowedAfter()')]:word(999999999)}});const r=await m.inspect(x.options);assert.equal(r.fields.mintCapability.evidence[0].mintCapPct,'2');assert.match(r.fields.mintCapability.evidence[0].scope,/does not claim/);
});
test('bounded role enumeration confirms membership and never promotes ABI to mint semantics',async()=>{
 const role='0'.repeat(64),source={digest:'unreviewed',abi:[fn('getRoleMemberCount',['bytes32'],'uint256'),fn('getRoleMember',['bytes32','uint256']),fn('hasRole',['bytes32','address'],'bool')]};
 const x=fixture({source,calls:{[m.selector('getRoleMemberCount(bytes32)')+role]:word(1),[m.selector('getRoleMember(bytes32,uint256)')+role+'0'.repeat(64)]:addr(B),[m.selector('hasRole(bytes32,address)')+role+B.slice(2).padStart(64,'0')]:word(1)}});const r=await m.inspect(x.options);assert.match(r.fields.ownerAdmin.value,/DEFAULT_ADMIN_ROLE/);assert.equal(r.fields.mintCapability,undefined);
});
test('diamond array rejects malformed offsets, duplicates, large count, dirty addresses and partial payloads',()=>{
 const valid='0x'+word(32).slice(2)+word(1).slice(2)+addr(B).slice(2);assert.deepEqual(m.decodeArray(valid),[B]);for(const raw of ['0x',word(0)+word(1).slice(2)+addr(B).slice(2),valid+'0'.repeat(64),'0x'+word(32).slice(2)+word(33).slice(2)])assert.equal(m.decodeArray(raw),null);
});
test('RPC failure preserves prior reviewed values and provides sanitized detail',async()=>{
 const card={fields:{tradingTaxes:{value:'Buy 3%',status:'VERIFIED_SOURCE',dataState:'DATA_FOUND',evidence:[{source:'reviewed'}]}}};const r=await m.enrich({network:'arc',address:A,block,rpc:async()=>{throw Error('secret endpoint credential')},sourceLoader:async()=>null,card});assert.equal(r.fields.tradingTaxes.value,'Buy 3%');assert.ok(!JSON.stringify(r).includes('credential'));
});
test('source coalescing and 429 cooldown cache only successful validated JSON',async()=>{
 let now=0,count=0;const r=createReader({now:()=>now}),url='https://sourcify.dev/example';const fetcher=async()=>{count++;return Response.json({ok:true})};await Promise.all([r.json(url,{fetcher}),r.json(url,{fetcher})]);assert.equal(count,1);now=20000;await assert.rejects(r.json(url,{fetcher:async()=>new Response('',{status:429,headers:{'Retry-After':'60'}})}));await assert.rejects(r.json(url,{fetcher}),{httpStatus:429});assert.equal(count,1);
});
test('exact network identity and malformed pinned block are rejected',async()=>{
 for(const change of [{network:'polygon'},{address:'0x1234'},{block:'latest'}])await assert.rejects(m.inspect({...fixture().options,...change}));
});
test('reviewed immutable beacon binding outranks a stale writable beacon slot',async()=>{
 const registry='0x'+'4'.repeat(40),code='0x7f'+addr(B).slice(2)+'f400';
 const outer={digest:'922425867904c46fb129080ebcd685ba70e0afb5aaa9fdc47b5f9327cee41196',abi:[],immutableReferences:{beacon:[{start:1,length:32}]}};
 const implementation={digest:profile('REGISTRY_AUTH_TOKEN'),abi:[]};
 const x=fixture({code,slots:{[m.SLOTS.beacon]:addr(registry)},targets:{[B]:basic,[C]:basic,[registry]:basic},calls:{[B+':'+m.selector('implementation()')]:addr(C),[m.selector('ACCESS_CONTROLLED_REGISTRY()')]:addr(registry)}});
 x.options.sourceLoader=async(_,address)=>address===A?outer:address===B?
  {digest:'b80e9ea9116556c182e12f8e786950a32985026edff7b62c73130ca3661eccdf',abi:[]}:implementation;
 const r=await m.inspect(x.options);assert.equal(r.fields.contractArchitecture.evidence[0].implementation,C);assert.match(r.fields.contractArchitecture.value,/immutable beacon/);assert.equal(r.fields.mintCapability.evidence[0].registry,registry);assert.ok(r.details.failures.some(x=>x.reason==='BEACON_SLOT_IMMUTABLE_MISMATCH'));
});
test('source body timeout and invalid schema never enter evidence cache',async()=>{
 const r=createReader();await assert.rejects(r.json('https://sourcify.dev/slow',{timeoutMs:10,fetcher:async(_,options)=>new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(Error('timeout')));}}))}));
 const url='https://sourcify.dev/invalid';await assert.rejects(r.json(url,{fetcher:async()=>Response.json({bad:true}),validate:()=>false}));let fetched=false;await r.json(url,{fetcher:async()=>{fetched=true;return Response.json({good:true})}});assert.equal(fetched,true);
});
test('Arc bridge includes only established transfer tax and never invents the missing rate',()=>{
 const bridge=require('../search/server/lib/arc-legacy-evidence'),f=value=>({value,status:'VERIFIED_SOURCE',dataState:'DATA_FOUND',source:'reviewed',evidence:[{address:A,chainId:5042,block}]});
 for(const value of [0,2,null,-1,101]){const r=bridge.contract({contractFields:{buyTax:f(3),sellTax:f(3),transferTax:f(value)}},A);assert.match(r.tradingTaxes.value,value!==null&&value>=0&&value<=100?new RegExp('Transfer '+value+'%'):/Transfer NOT VERIFIED/);}
});
test('diamond loupe-shaped response alone is not verified routing/architecture',async()=>{
 const raw='0x'+word(32).slice(2)+word(1).slice(2)+addr(B).slice(2),x=fixture({code:delegate,targets:{[B]:basic},calls:{[m.selector('facetAddresses()')]:raw}});const r=await m.inspect(x.options);assert.equal(r.fields.contractArchitecture,undefined);assert.equal(r.details.observations[0].facets[0],B);
});
