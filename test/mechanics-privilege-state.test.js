'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const privilege=require('../search/server/lib/mechanics-privilege-state');
const S=privilege.selector,ZERO='0x'+'0'.repeat(40);
const A=n=>'0x'+n.toString(16).padStart(40,'0');
const word=a=>'0x'+a.slice(2).padStart(64,'0');
// Runtime with a solc-style dispatcher: DUP1 PUSH4 <selector> EQ PUSH2 <dest> JUMPI for each function.
const runtime=(signatures,extra='')=>'0x6080604052'+signatures.map(s=>'8063'+S(s).slice(2)+'1461010057').join('')+extra+'00';
const TOKEN=A(0xc0ffee),OWNER=A(0xabc),IMPL=A(0x1337);

// A tiny contract model: `gate(from,selector)` decides success/revert for simulated calls.
function node({chainId=1,codes={},storage={},owner,gate=()=>false,fail={}}={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  const {id,method,params}=JSON.parse(init.body);calls.push({method,params});
  const reply=body=>new Response(JSON.stringify({jsonrpc:'2.0',id,...body}),{status:200});
  if(fail[method])return fail[method]==='http'?new Response('{}',{status:503}):reply({error:fail[method]});
  if(method==='eth_chainId')return reply({result:'0x'+chainId.toString(16)});
  if(method==='eth_blockNumber')return reply({result:'0x1312d00'});
  if(method==='eth_getCode')return reply({result:codes[params[0].toLowerCase()]||'0x'});
  if(method==='eth_getStorageAt')return reply({result:storage[params[1]]||'0x'+'0'.repeat(64)});
  if(method==='eth_call'){
   const selector=params[0].data.slice(0,10),from=(params[0].from||ZERO).toLowerCase();
   assert.equal(params[1],'0x1312d00','every simulation is pinned to the analysis block');
   if(selector===S('owner()'))return owner===undefined?reply({error:{code:3,message:'execution reverted'}}):reply({result:word(owner)});
   const outcome=gate(from,selector);
   if(outcome==='provider')return reply({error:{code:-32005,message:'rate limit exceeded'}});
   return outcome?reply({result:'0x'}):reply({error:{code:-32000,message:'execution reverted: Ownable: caller is not the owner'}});
  }
  return reply({error:{code:-32601,message:'method not found'}});
 };
 return {fetcher,calls};
}
const run=(n,network='ethereum')=>privilege.classify({network,address:TOKEN,fetcher:n.fetcher,url:'https://rpc.example.test',paceMs:0});
const state=(result,signature)=>result.functions.find(f=>f.signature===signature)?.state;

test('dispatcher scan accepts compared selectors only',()=>{
 const mint=S('mint(address,uint256)').slice(2),pause=S('pause()').slice(2),burn='42966c68';
 // mint: DUP1 PUSH4 EQ; pause: PUSH4 DUP2 EQ (older solc); burn selector only stored as data; a selector hidden inside PUSH32 data.
 const code='0x'+'8063'+mint+'14'+'63'+pause+'8114'+'63'+burn+'600052'+'7f'+'63'+S('unpause()').slice(2)+'14'+'00'.repeat(26);
 const found=privilege.dispatchSelectors(code);
 assert.deepEqual([...found].sort(),['0x'+mint,'0x'+pause].sort());
 assert.equal(privilege.dispatchSelectors('0x').size,0);assert.equal(privilege.dispatchSelectors('not-hex').size,0);
});

test('five states are kept apart: executable, confirmed, detected, revoked, unknown',async()=>{
 const code=runtime(['owner()','mint(address,uint256)','pause()','unpause()','blacklist(address)','transferOwnership(address)','grantRole(bytes32,address)']);
 // Owner may mint and pause; unpause reverts for everyone (not paused); blacklist is gated by someone else.
 const live=node({codes:{[TOKEN]:code},owner:OWNER,gate:(from,sel)=>from===OWNER&&[S('mint(address,uint256)'),S('pause()')].includes(sel)});
 const result=await run(live);
 assert.equal(result.status,'ANALYZED');assert.equal(result.block,'0x1312d00');
 assert.equal(state(result,'mint(address,uint256)'),'PRIVILEGE_CURRENTLY_EXECUTABLE');
 assert.equal(state(result,'pause()'),'PRIVILEGE_CURRENTLY_EXECUTABLE');
 assert.equal(state(result,'unpause()'),'PRIVILEGE_CONFIRMED');
 assert.equal(state(result,'blacklist(address)'),'FUNCTION_DETECTED');
 // Argument-bearing administrative functions are detected, never simulated.
 assert.equal(state(result,'transferOwnership(address)'),'FUNCTION_DETECTED');assert.equal(state(result,'grantRole(bytes32,address)'),'FUNCTION_DETECTED');
 assert.ok(!live.calls.some(c=>c.method==='eth_call'&&[S('transferOwnership(address)'),S('grantRole(bytes32,address)')].includes(c.params[0].data.slice(0,10))));
 assert.deepEqual(result.authorities,[{kind:'OWNER',holder:OWNER,holderType:'EOA',state:'ACTIVE',method:'owner()',block:'0x1312d00'}]);
 assert.equal(result.summary.currentlyExecutable,2);assert.equal(result.summary.privilegeConfirmed,1);assert.equal(result.summary.functionDetectedOnly,3);
 const mint=result.functions.find(f=>f.signature==='mint(address,uint256)');
 assert.equal(mint.authority,OWNER);assert.equal(mint.evidence.length,3);assert.equal(mint.evidence[1].outcome,'REVERTS');assert.equal(mint.evidence[2].outcome,'SUCCEEDS');
 // No transaction method is ever sent and the budget holds.
 assert.ok(live.calls.every(c=>['eth_chainId','eth_blockNumber','eth_getCode','eth_getStorageAt','eth_call'].includes(c.method)));
 assert.ok(result.cost.rpcCalls<=28);

 // Renounced ownership: only the zero address passes the gate -> revoked, with the zero owner reported as an authority.
 const renounced=node({codes:{[TOKEN]:runtime(['owner()','mint(address,uint256)','pause()'])},owner:ZERO,gate:(from,sel)=>from===ZERO&&sel===S('mint(address,uint256)')});
 const gone=await run(renounced);
 assert.equal(state(gone,'mint(address,uint256)'),'PRIVILEGE_REVOKED');assert.equal(state(gone,'pause()'),'FUNCTION_DETECTED');
 assert.equal(gone.authorities[0].state,'REVOKED');assert.equal(gone.authorities[0].holderType,'ZERO_ADDRESS');

 // A provider error during simulation is UNKNOWN, never a revert and never a privilege claim.
 const flaky=node({codes:{[TOKEN]:runtime(['owner()','mint(address,uint256)'])},owner:OWNER,gate:()=>'provider'});
 assert.equal(state(await run(flaky),'mint(address,uint256)'),'UNKNOWN');
});

test('unrestricted functions and role-gated contracts are not reported as owner privileges',async()=>{
 // Public mint (e.g. a faucet token): succeeds for the unrelated control address.
 const open=node({codes:{[TOKEN]:runtime(['owner()','mint(address,uint256)'])},owner:OWNER,gate:()=>true});
 const result=await run(open),mint=result.functions[0];
 assert.equal(mint.state,'FUNCTION_DETECTED');assert.equal(mint.unrestrictedInSimulation,true);assert.equal(result.summary.unrestrictedInSimulation,1);
 // The authority simulation is skipped once the control call succeeds.
 assert.equal(open.calls.filter(c=>c.method==='eth_call'&&c.params[0].data.startsWith(S('mint(address,uint256)'))).length,1);
 // AccessControl-only contract: no owner() getter, so the authority is not guessed.
 const roles=node({codes:{[TOKEN]:runtime(['mint(address,uint256)','grantRole(bytes32,address)'])},gate:()=>false});
 const gated=await run(roles);
 assert.equal(state(gated,'mint(address,uint256)'),'FUNCTION_DETECTED');assert.match(gated.functions[0].note,/authority .* is not identified/);
 assert.deepEqual(gated.authorities,[]);
});

test('proxies are analysed through their implementation and report the upgrade authority',async()=>{
 const proxyCode=runtime(['upgradeTo(address)']),logic=runtime(['owner()','mint(address,uint256)']),ADMIN=A(0xad);
 const modern=node({codes:{[TOKEN]:proxyCode,[IMPL]:logic,[ADMIN]:'0x6000'},storage:{[privilege.IMPLEMENTATION_SLOT]:word(IMPL),[privilege.ADMIN_SLOT]:word(ADMIN)},owner:OWNER,gate:from=>from===OWNER});
 const result=await run(modern);
 assert.deepEqual(result.proxy,{kind:'EIP-1967 proxy',implementation:IMPL});
 assert.equal(state(result,'mint(address,uint256)'),'PRIVILEGE_CURRENTLY_EXECUTABLE');assert.equal(state(result,'upgradeTo(address)'),'FUNCTION_DETECTED');
 const admin=result.authorities.find(a=>a.kind==='PROXY_ADMIN');
 assert.equal(admin.holder,ADMIN);assert.equal(admin.holderType,'CONTRACT');assert.match(admin.scope,/who controls it is a separate question/);
 // Pre-EIP-1967 proxy slots are the reviewed constants already used by mechanics-deep.js.
 const deep=require('../search/server/lib/mechanics-deep').SLOTS;
 assert.equal(privilege.LEGACY_IMPLEMENTATION_SLOT,deep.legacy);assert.equal(privilege.LEGACY_ADMIN_SLOT,deep.legacyAdmin);assert.equal(privilege.IMPLEMENTATION_SLOT,deep.implementation);assert.equal(privilege.ADMIN_SLOT,deep.admin);
 const legacy=node({codes:{[TOKEN]:proxyCode,[IMPL]:logic},storage:{[privilege.LEGACY_IMPLEMENTATION_SLOT]:word(IMPL),[privilege.LEGACY_ADMIN_SLOT]:word(OWNER)},owner:OWNER,gate:from=>from===OWNER});
 const old=await run(legacy);
 assert.equal(old.proxy.kind,'Legacy (zos) proxy');assert.equal(old.authorities.find(a=>a.kind==='PROXY_ADMIN').holderType,'EOA');
 // EIP-1967 beacon proxy: logic comes from beacon.implementation(); the beacon owner is the upgrade authority.
 const BEACON=A(0xbeac),beaconNode=node({codes:{[TOKEN]:proxyCode,[IMPL]:logic,[BEACON]:'0x6000'},storage:{[privilege.BEACON_SLOT]:word(BEACON)},owner:OWNER,gate:from=>from===OWNER});
 const inner=beaconNode.fetcher;
 beaconNode.fetcher=async(url,init)=>{const r=JSON.parse(init.body);if(r.method==='eth_call'&&r.params[0].to===BEACON&&r.params[0].data===S('implementation()'))return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,result:word(IMPL)}),{status:200});return inner(url,init);};
 const viaBeacon=await run(beaconNode);
 assert.deepEqual(viaBeacon.proxy,{kind:'EIP-1967 beacon proxy',implementation:IMPL,beacon:BEACON});assert.equal(privilege.BEACON_SLOT,deep.beacon);
 assert.equal(state(viaBeacon,'mint(address,uint256)'),'PRIVILEGE_CURRENTLY_EXECUTABLE');
 assert.ok(viaBeacon.authorities.some(a=>a.kind==='BEACON_OWNER'&&a.holder===OWNER));
 // EIP-1167 clone.
 const clone=node({codes:{[TOKEN]:'0x363d3d373d3d3d363d73'+IMPL.slice(2)+'5af43d82803e903d91602b57fd5bf3',[IMPL]:logic},owner:OWNER,gate:from=>from===OWNER});
 assert.equal((await run(clone)).proxy.kind,'EIP-1167 minimal proxy');
});

test('failures are explicit and never look like an analysed contract',async()=>{
 assert.equal((await run(node({fail:{eth_chainId:'http'}}))).status,'PROVIDER_UNAVAILABLE');
 assert.equal((await run(node({chainId:56}))).reasonCode,'CHAIN_ID_MISMATCH');
 assert.equal((await run(node({codes:{}}))).status,'NO_CONTRACT_CODE');
 await assert.rejects(()=>privilege.classify({network:'ethereum',address:'0x12'}),{code:'INVALID_ADDRESS'});
 await assert.rejects(()=>privilege.classify({network:'bsc',address:TOKEN}));
 const reader=privilege.createReader({url:'https://rpc.example.test',chainId:1,fetcher:node().fetcher});
 await assert.rejects(()=>reader.send('eth_sendRawTransaction',['0x']),/PRIVILEGE_METHOD_NOT_ALLOWED/);
 // Hard call budget.
 const tight=privilege.createReader({url:'https://rpc.example.test',chainId:1,fetcher:node().fetcher,maxCalls:1});
 await tight.send('eth_chainId',[]);assert.equal((await tight.send('eth_chainId',[])).state,'BUDGET');
});

test('GET /api/search?action=privileges validates input before any read',async()=>{
 const handler=require('../api/search/index.js');
 const call=async(url,method='GET')=>{const out={headers:{}};const res={setHeader:(k,v)=>{out.headers[k]=v;},status(n){out.status=n;return res;},json(d){out.body=d;return res;}};await handler({method,url,query:{},headers:{}},res);return out;};
 assert.equal((await call('/api/search?action=privileges&chain=ethereum&address=0x12')).body.error,'VALID_CONTRACT_REQUIRED');
 assert.equal((await call('/api/search?action=privileges&chain=bsc&address='+TOKEN)).body.error,'UNSUPPORTED_CHAIN');
 assert.equal((await call('/api/search?action=privileges&chain=ethereum&address='+TOKEN,'POST')).status,405);
});
