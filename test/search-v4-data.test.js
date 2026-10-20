'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const v4=require('../search/server/lib/mechanics-reviewed-v4'),m=require('../search/server/lib/mechanics-deep');
const pub=require('../search/server/lib/arc-holder-publication');
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40),block='0x123';
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),addr=a=>'0x'+a.slice(2).padStart(64,'0');
const profile=name=>Object.keys(v4.PROFILES).find(k=>v4.PROFILES[k]===name);
async function reviewed(name,{calls={},direct=true,fields={},admin=null}={}){
 const details={observations:[]};await v4.apply({profile:name,fields,details,proof:{sourceDigest:profile(name)},direct,admin,
  fact:(value,method,extra,status)=>({value,method,evidence:[extra],status}),word:async(_,s)=>calls[s]??null,
  call:async(_,s)=>calls[s]??null,address:A,block,keccak:require('../lib/keccak')});return {fields,details};
}
function signed({at=Date.now()-72*3600000,anchor='0x'+'1'.repeat(64)}={}){
 const pair=crypto.generateKeyPairSync('ed25519');
 const snapshot={status:'ONCHAIN_VERIFIED',coverage:{complete:true},block,snapshot:{block,completedAt:new Date(at).toISOString()},
  holderCount:2,largestWalletPct:60,top10Pct:100,top20Pct:100,evidence:[{block,anchor}]};
 snapshot.fields=Object.fromEntries(pub.KEYS.map(k=>[k,{value:snapshot[k],dataState:'DATA_FOUND',status:'ONCHAIN_VERIFIED',evidence:[{block,anchor}]}]));
 const sign=payload=>{const text=JSON.stringify(payload);return {payload:text,signature:crypto.sign(null,Buffer.from(text),pair.privateKey).toString('base64')};};
 return {snapshot,pair,sign,document:sign({chainId:5042,address:A,snapshot}),
  env:{ARC_HOLDER_PUBLISHED_URL:'https://publication.example/snapshots/',ARC_HOLDER_PUBLIC_KEY:pair.publicKey.export({type:'spki',format:'pem'})}};
}

test('unreviewed source/selector never inherits reviewed V4 behaviors',async()=>{
 const {fields}=await reviewed('mint');assert.deepEqual(fields,{});
 const r=await m.inspect({network:'ethereum',address:A,block,rpc:async()=> '0x600000',
  sourceLoader:async()=>({digest:'unreviewed',abi:[{type:'function',name:'mint',inputs:[],outputs:[],stateMutability:'nonpayable'}]})});
 assert.equal(r.fields.mintCapability,undefined);assert.equal(r.fields.tradingTaxes,undefined);
});

test('reviewed fixed supply/wrapper absence is limited to direct runtimes, preserving residual proxy authority',async()=>{
 for(const name of ['FIXED_ERC677','NATIVE_DEPOSIT_WRAPPER','FIXED_LAUNCH_RESTRICTIONS']){
  const direct=await reviewed(name);assert.match(direct.fields.tradingTaxes.value,/Transfer 0%.*DEX\/hook fees NOT VERIFIED/);
  assert.equal(direct.fields.tradingTaxes.evidence[0].coverage,'TOKEN_TRANSFER_ONLY');
  const existing={value:'Proxy admin remains'},proxy=await reviewed(name,{direct:false,fields:{ownerAdmin:existing}});
  assert.equal(proxy.fields.ownerAdmin,existing);
  if(name!=='NATIVE_DEPOSIT_WRAPPER')assert.equal(proxy.fields.mintCapability,undefined);
 }
});

test('owned issuance needs a nonzero pinned owner and unfinished mint state; zero owner proves no absence',async()=>{
 for(const calls of [{},{'owner()':word(0),'mintingFinished()':word(0)},{'owner()':addr(B),'mintingFinished()':word(1)}])
  assert.equal((await reviewed('OWNED_ISSUANCE_PAUSABLE',{calls})).fields.mintCapability,undefined);
 const r=await reviewed('OWNED_ISSUANCE_PAUSABLE',{calls:{'owner()':addr(B),'mintingFinished()':word(0)}});
 assert.equal(r.fields.mintCapability.evidence[0].owner,B);assert.equal(r.fields.mintCapability.status,'VERIFIED_SOURCE_AND_STATE');
});

test('governed minter and role authority require reviewed execution and matching pinned getters',async()=>{
 assert.equal((await reviewed('GOVERNED_MINTER_SET')).fields.ownerAdmin,undefined);
 assert.ok((await reviewed('GOVERNED_MINTER_SET',{calls:{'governor()':addr(B)}})).fields.mintCapability);
 for(const role of [null,word(1)])assert.equal((await reviewed('ROLE_TIMELOCK_TRANSFER',{calls:{'MINTER_ROLE()':role,'getRoleAdmin(bytes32)':word(0)}})).fields.mintCapability,undefined);
 const role=require('../lib/keccak')(Buffer.from('MINTER_ROLE'));
 const r=await reviewed('ROLE_TIMELOCK_TRANSFER',{calls:{'MINTER_ROLE()':role,'getRoleAdmin(bytes32)':word(0)}});
 assert.match(r.fields.mintCapability.evidence[0].scope,/Current membership.*not claimed/);
 assert.match(r.fields.ownerAdmin.evidence[0].scope,/not a complete member list/);
});

test('launch pool fee/restrictions are evidence, never token buy/sell fees or deployer ownership',async()=>{
 const r=await reviewed('FIXED_LAUNCH_RESTRICTIONS',{calls:{'launchFactory()':addr(B),'poolFee()':word(3000),'restrictionEndBlock()':word(200)}});
 assert.match(r.fields.ownerAdmin.value,/Launch factory/);assert.match(r.fields.tradingTaxes.value,/DEX\/hook fees NOT VERIFIED/);
 assert.ok(r.details.observations.some(x=>x.method==='poolFee()'&&x.raw==='3000'));
});

test('reviewed compliance role mint and upgradeable no-mint evidence preserve restrictions and residual authority',async()=>{
 const role=require('../lib/keccak')(Buffer.from('MINTER_ROLE'));
 assert.equal((await reviewed('COMPLIANCE_ROLE_TOKEN')).fields.mintCapability,undefined);
 const r=await reviewed('COMPLIANCE_ROLE_TOKEN',{calls:{'MINTER_ROLE()':role}});
 assert.ok(r.fields.mintCapability);assert.match(r.fields.tradingTaxes.evidence[0].scope,/KYC.*revert/);
 assert.equal((await reviewed('UPGRADEABLE_NO_DIRECT_MINT',{direct:false})).fields.mintCapability,undefined);
 const proxy=await reviewed('UPGRADEABLE_NO_DIRECT_MINT',{direct:false,admin:B});
 assert.match(proxy.fields.mintCapability.value,/upgradeable/);assert.match(proxy.fields.mintCapability.evidence[0].scope,/NOT permanent fixed-supply/);
});

test('verified slot-proxy source is required before borrowing reviewed implementation behavior',async()=>{
 const role=require('../lib/keccak')(Buffer.from('MINTER_ROLE'));
 for(const valid of [false,true]){
  const r=await m.inspect({network:'ethereum',address:A,block,rpc:async(method,p)=>{
   assert.equal(p.at(-1),block);
   if(method==='eth_getCode')return p[0]===A?'0x60006000f400':p[0]===B?'0x600000':'0x';
   if(method==='eth_getStorageAt')return p[1]===m.SLOTS.implementation?addr(B):word(0);
   return p[0].data===m.selector('MINTER_ROLE()')?role:word(0);
  },sourceLoader:async(_,a)=>({digest:a===A?(valid?Object.keys(v4.PROXY_SOURCES)[0]:'unreviewed'):profile('COMPLIANCE_ROLE_TOKEN'),abi:[]})});
  assert.equal(Boolean(r.fields.mintCapability),valid);assert.equal(Boolean(r.fields.tradingTaxes),valid);
 }
});

test('immutable beacon template accepts only the exact complete runtime with its single declared address immutable',()=>{
 const bytes=Buffer.from(require('./fixtures/reviewed-beacon-runtime.json').maskedRuntime.slice(2),'hex');
 Buffer.from(addr(B).slice(2),'hex').copy(bytes,29);const code='0x'+bytes.toString('hex');assert.equal(v4.immutableBeacon(code).beacon,B);
 for(const i of [0,28,61,282]){const bad=Buffer.from(bytes);bad[i]^=1;assert.equal(v4.immutableBeacon('0x'+bad.toString('hex')),null);}
 const bad=Buffer.from(bytes);bad[29]=1;assert.equal(v4.immutableBeacon('0x'+bad.toString('hex')),null);
 assert.equal(v4.immutableBeacon(code+'00'),null);
});

test('missing outer source may use exact template only with reviewed bytecode-matched beacon execution and pinned implementation',async()=>{
 const bytes=Buffer.from(require('./fixtures/reviewed-beacon-runtime.json').maskedRuntime.slice(2),'hex');Buffer.from(addr(B).slice(2),'hex').copy(bytes,29);
 const code='0x'+bytes.toString('hex'),implementation={digest:profile('FIXED_ERC677'),abi:[]};
 for(const valid of [false,true]){
  const r=await m.inspect({network:'robinhood',address:A,block,rpc:async(method,p)=>{
   assert.equal(p.at(-1),block);
   if(method==='eth_getCode')return p[0]===A?code:p[0]===B||p[0]===C?'0x600000':'0x';
   if(method==='eth_getStorageAt')return word(0);
   if(method==='eth_call'&&p[0].to===B){assert.equal(p[0].from,A);return addr(C);}
   return word(0);
  },sourceLoader:async(_,a)=>a===A?null:a===B?{digest:valid?Object.keys(v4.BEACON_SOURCES)[0]:'unreviewed',abi:[]}:implementation});
  assert.equal(Boolean(r.fields.tradingTaxes),valid);
  assert.equal(r.fields.mintCapability,undefined,'Upgradable implementation is not constructor-only fixed supply proof');
  assert.ok(valid?r.details.runtimeTemplate:r.details.failures.some(x=>x.reason==='BEACON_EXECUTION_SOURCE_UNREVIEWED'));
 }
});

test('old signed COMPLETE remains explicitly historical instead of becoming empty after48h',async()=>{
 const x=signed(),r=await pub.load(A,{env:x.env,fetcher:async()=>Response.json(x.document)});
 for(const field of Object.values(r.fields)){assert.equal(field.dataState,'DATA_FOUND');assert.equal(field.freshness.state,'LAST_VERIFIED');assert.equal(field.freshness.block,block);}
 assert.match(r.description,/historical as of/);
});

test('signed cache preserves COMPLETE on404/429/timeout/invalid signature; feed/key/contract are isolated',async()=>{
 const x=signed();await pub.load(A,{env:x.env,fetcher:async()=>Response.json(x.document)});
 for(const fetcher of [async()=>new Response(null,{status:404}),async()=>new Response(null,{status:429}),async()=>{throw Error('Timeout')},async()=>Response.json({...x.document,signature:Buffer.alloc(64).toString('base64')})]){
  const r=await pub.load(A,{env:x.env,fetcher});assert.equal(r.fields.holderCount.value,2);assert.equal(r.fields.top20Pct.freshness.state,'LAST_VERIFIED');
 }
 for(const [address,env]of [[B,x.env],[A,{...x.env,ARC_HOLDER_PUBLISHED_URL:'https://other.example/snapshots/'}],[A,signed().env]]){
  const r=await pub.load(address,{env,fetcher:async()=>new Response(null,{status:429})});assert.equal(r.fields.holderCount.dataState,'NOT_VERIFIED');
 }
});

test('different block anchors cannot be mixed into one signed COMPLETE even with a valid signature',()=>{
 const x=signed();x.snapshot.fields.top10Pct.evidence[0].anchor='0x'+'2'.repeat(64);
 assert.equal(pub.verifyDocument(x.sign({chainId:5042,address:A,snapshot:x.snapshot}),A,x.pair.publicKey),null);
 x.snapshot.fields.top10Pct.evidence[0].anchor=x.snapshot.evidence[0].anchor;x.snapshot.evidence.push({block,anchor:'0x'+'3'.repeat(64)});
 assert.equal(pub.verifyDocument(x.sign({chainId:5042,address:A,snapshot:x.snapshot}),A,x.pair.publicKey),null);
});

test('complete Ethereum census rejects mixed-case duplicate wallets even if their duplicated balances sum to supply',()=>{
 const a='0x'+'aB'.repeat(20);assert.throws(()=>require('../search/server/lib/holder-snapshot').reconcile([a,a.toLowerCase()],[50n,50n],2,'100',A,block),/Invalid holder address/);
});

test('burn share rejects invalid data and never emits scientific notation or misleading zero for tiny positives',()=>{
 const html=fs.readFileSync('search/index.html','utf8'),body=html.slice(html.indexOf('function displayBurnShare('),html.indexOf('function render(report)'));
 const display=new Function(body+';return displayBurnShare;')();
 assert.equal(display(0),'0%');assert.equal(display(1e-15),'<0.0001%');assert.equal(display(1e-9),'<0.0001%');assert.equal(display(0.0000999),'<0.0001%');assert.equal(display(0.0001),'0.0001%');assert.equal(display(100),'100%');
 for(const n of [-1,NaN,Infinity,101,null,'0.1'])assert.equal(display(n),'NOT VERIFIED');
});

test('warm validated art survives another thumbnail exhausting the aggregate deadline, without new HTTP reads',async()=>{
 const logos=require('../search/server/lib/search-logo'),images=require('../search/server/lib/logo-validation'),art=require('./helpers/logo-artwork.cjs');
 const saved=global.fetch,warm='https://cdn.dexscreener.com/cms/images/v4-warm.png';let warmReads=0;
 global.fetch=async(u,o)=>{if(u===warm){warmReads++;return art.response();}return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('Timeout')),{once:true}));};
 try{
  assert.ok(await images.validate(warm));
  const rows=[0,1,2,3].map(i=>({network:'ethereum',chainId:1,address:'0x'+String(i+1).repeat(40),logoUrl:i===3?warm:'https://cdn.dexscreener.com/cms/images/v4-slow-'+i+'.png'}));
  const out=await logos.enhance('ethereum',rows);assert.equal(out[3].logoUrl,warm);assert.equal(warmReads,1);
  assert.equal(images.cached(warm,{now:Date.now()+901000}),undefined);
 }finally{global.fetch=saved;}
});
