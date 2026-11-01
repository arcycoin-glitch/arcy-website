'use strict';
// Adversarial transient-vs-deterministic RPC error handling (backend only).
const test=require('node:test'),assert=require('node:assert/strict');
const {transientRpcError}=require('../search/server/lib/rpc-errors');
const rh=require('../search/server/lib/robinhood-rpc');
const ADDRESS='0x'+'a'.repeat(40);
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('transientRpcError: only provider-side temporary conditions are transient',()=>{
 for(const e of [{code:-32005,message:'limit exceeded'},{code:-32016,message:'x'},{code:-32000,message:'Too many requests, retry later'},{code:-32603,message:'upstream timed out'}])
  assert.equal(transientRpcError(e),true,JSON.stringify(e));
 for(const e of [{code:3,message:'execution reverted'},{code:-32000,message:'execution reverted: rate limit exceeded'},{code:-32000,message:'invalid opcode'},
  {code:-32602,message:'invalid params'},{code:-32601,message:'method not found'},{code:-32000,message:'out of gas'},null,undefined,'rate limit',{}])
  assert.equal(transientRpcError(e),false,JSON.stringify(e));
});
test('Robinhood: JSON-RPC rate limit on primary fails over to chain-checked backup',async()=>{
 const original=global.fetch,calls=[];
 const env={ROBINHOOD_RPC_URL:'https://primary.example',ROBINHOOD_RPC_FALLBACK_URL:'https://backup.example'};
 const saved={...process.env};Object.assign(process.env,env);
 global.fetch=async(url,{body})=>{
  const b=JSON.parse(body);calls.push([new URL(url).hostname,b.method]);
  if(new URL(url).hostname==='primary.example')return reply({jsonrpc:'2.0',id:b.id,error:{code:-32005,message:'rate limited'}});
  return reply({jsonrpc:'2.0',id:b.id,result:b.method==='eth_chainId'?'0x1237':'0x10'});
 };
 try{
  assert.equal(await rh.rpc('eth_blockNumber',[]),'0x10');
  assert.deepEqual(calls.map(c=>c[0]+':'+c[1]),['primary.example:eth_blockNumber','backup.example:eth_chainId','backup.example:eth_blockNumber']);
 }finally{global.fetch=original;process.env=saved}
});
test('Robinhood: a contract revert is deterministic and is NOT re-sent to the backup',async()=>{
 const original=global.fetch,calls=[];
 const saved={...process.env};Object.assign(process.env,{ROBINHOOD_RPC_URL:'https://primary.example',ROBINHOOD_RPC_FALLBACK_URL:'https://backup.example'});
 global.fetch=async(url,{body})=>{const b=JSON.parse(body);calls.push(new URL(url).hostname);return reply({jsonrpc:'2.0',id:b.id,error:{code:3,message:'execution reverted'}})};
 try{
  await assert.rejects(rh.rpc('eth_call',[{to:ADDRESS,data:'0x8da5cb5b'},'latest']),/invalid response/);
  assert.deepEqual(calls,['primary.example']);
 }finally{global.fetch=original;process.env=saved}
});
test('Robinhood: wrong chain on backup is rejected, never accepted as evidence',async()=>{
 const original=global.fetch;
 const saved={...process.env};Object.assign(process.env,{ROBINHOOD_RPC_URL:'https://primary.example',ROBINHOOD_RPC_FALLBACK_URL:'https://backup.example'});
 global.fetch=async(url,{body})=>{
  const b=JSON.parse(body);
  if(new URL(url).hostname==='primary.example')return reply({},503);
  return reply({jsonrpc:'2.0',id:b.id,result:'0x1'}); // Ethereum chain id from a "Robinhood" backup
 };
 try{await assert.rejects(rh.rpc('eth_blockNumber',[]),/chain ID mismatch/)}
 finally{global.fetch=original;process.env=saved}
});
test('Discovery: a slow-but-valid explorer answer (1.2 s) is kept; registry/DEX failures do not blank it',async()=>{
 const explorer=require('../search/server/lib/discover'),service=require('../search/server/lib/multichain-service');
 const original=explorer.searchExplorer;
 explorer.searchExplorer=async(network)=>{await new Promise(r=>setTimeout(r,1200));return [{address:'0x'+'1'.repeat(40),network,chainId:1,name:'Slowcoin',symbol:'SLOW',source:'Blockscout explorer index',identityVerified:false,registryMatched:false}]};
 try{
  const r=await service.discover({network:'ethereum',query:'slowcoin'});
  assert.equal(r.matches.length,1);
  assert.equal(r.matches[0].address,'0x'+'1'.repeat(40));
  assert.equal(r.matches[0].chainId,1);
 }finally{explorer.searchExplorer=original}
});
test('Discovery: a hung explorer is abandoned within a bounded window and reported as unavailable',async()=>{
 const explorer=require('../search/server/lib/discover'),service=require('../search/server/lib/multichain-service');
 const original=explorer.searchExplorer;
 explorer.searchExplorer=()=>new Promise(()=>{});
 const t=Date.now();
 try{
  const r=await service.discover({network:'ethereum',query:'hungcoin'});
  const took=Date.now()-t;
  assert.ok(took<4600,'bounded: '+took);
  assert.ok(r.unavailableSources.includes('Blockscout explorer index'));
  assert.equal(r.providerError,true);
 }finally{explorer.searchExplorer=original}
});
test('Diagnostics: new provider labels and the deadline outcome are accepted; no identifiers are retained',()=>{
 const d=require('../search/server/lib/diagnostics');
 assert.equal(d.provider('https://explorer.arc.io/api/v2/search?q=0x'+'a'.repeat(40)),'explorer');
 assert.equal(d.provider('https://robinhoodchain.blockscout.com/api/v2/search'),'explorer');
 assert.equal(d.provider('https://api.robinhood.com/rhj/assets'),'registry');
 d.record('source','registry','deadline',0);d.record('source','not-a-provider','deadline',0);d.record('source','explorer','bogus',0);
 const snap=JSON.stringify(d.snapshot());
 assert.match(snap,/"registry"/);assert.doesNotMatch(snap,/not-a-provider|bogus|0xa{40}/);
});
test('Discovery identity: chain mismatch dropped, same symbol/address on two chains stays two identities, ticker is never proof',()=>{
 const service=require('../search/server/lib/multichain-service');
 const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
 const ok=(network,chainId,matches)=>({status:'fulfilled',value:{ok:true,network,chainId,matches}});
 const item=(network,chainId,address,extra={})=>({network,chainId,address,name:'Dup',symbol:'DUP',...extra});
 const out=service.combineDiscoveryResults('dup',[
  ok('arc',5042,[item('arc',5042,A),item('arc',1,B),item('ethereum',1,B)]), // wrong chainId + wrong network label
  ok('ethereum',1,[item('ethereum',1,A),item('ethereum',1,A.toUpperCase().replace('0X','0x'))]), // same address on another chain; case-duplicate
  ok('robinhood',4663,[item('robinhood',4663,'0xnot-an-address')])
 ]);
 const keys=out.matches.map(m=>m.network+':'+m.address);
 assert.deepEqual(keys,['arc:'+A,'ethereum:'+A]);
 assert.ok(out.matches.every(m=>!m.identityVerified&&m.identity?.status!=='OFFICIAL_CONTRACT_MATCHED'));
 assert.throws(()=>service.combineDiscoveryResults('dup',[{status:'rejected',reason:Error('x')},{status:'rejected',reason:Error('x')},{status:'rejected',reason:Error('x')}]),/unavailable/);
});
