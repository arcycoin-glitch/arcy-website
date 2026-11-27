'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const pons=require('../lib/radar-v2/pons'),{PONS}=require('../lib/radar-v2/sources');
const A=i=>'0x'+i.toString(16).padStart(40,'0'),W=n=>BigInt(n).toString(16).padStart(64,'0');
const token=A(1),other=A(2);
const empty=version=>'0x'+'0'.repeat(version==='v2'?960:832);
function positive(t,version='v1'){
 const words=Array(version==='v2'?15:13).fill(W(0));words[0]=W(t);words[1]=W(A(90));
 if(version==='v2'){words[2]=W(A(91));words[4]=W(PONS.weth);words[10]=W(2);words[14]=W(1);}
 else{words[2]=W(PONS.weth);words[11]=W(1);}
 return '0x'+words.join('');
}
function fixture(answers){
 const requests=[];
 const fetcher=async(_url,options)=>{
  const calls=JSON.parse(options.body);requests.push(calls);
  const body=calls.map(c=>{
   if(c.method==='eth_chainId')return {jsonrpc:'2.0',id:c.id,result:'0x1237'};
   if(c.method==='eth_blockNumber')return {jsonrpc:'2.0',id:c.id,result:'0x12345'};
   if(c.params[0].data.startsWith(pons.SEL.graduationStatus))return {jsonrpc:'2.0',id:c.id,result:'0x'+[W(1),W(2),W(0)].join('')};
   const f=c.params[0].to,answer=answers[f];
   return answer?.error?{jsonrpc:'2.0',id:c.id,error:answer.error}:{jsonrpc:'2.0',id:c.id,result:answer??empty(PONS.versions[f])};
  });
  return {ok:true,status:200,text:async()=>JSON.stringify(body)};
 };
 return {requests,context:{fetcher,now:()=>Date.parse('2026-11-27T04:00:00Z')}};
}
test('factory absence requires an ABI-sized canonical false flag; malformed positive identity is unknown',()=>{
 for(const version of ['v1','v2']){
  assert.equal(pons.launchObservation(empty(version),token,version).status,'ABSENT');
  assert.equal(pons.launchObservation(positive(token,version),token,version).status,'MEMBER');
  assert.equal(pons.launchObservation(positive(other,version),token,version).status,'UNAVAILABLE');
  assert.equal(pons.launchObservation('0x',token,version).status,'UNAVAILABLE');
  const invalid=positive(token,version).slice(2).match(/.{64}/g);invalid[version==='v2'?14:11]=W(2);
  assert.equal(pons.launchObservation('0x'+invalid.join(''),token,version).status,'UNAVAILABLE');
 }
 assert.equal(pons.launchObservation(empty('v1'),token,'v2').status,'UNAVAILABLE','V1-shaped zero response cannot prove V2 absence');
});
test('one factory error cannot establish nonmembership or silently remove a launch; no retry is added',async()=>{
 const x=fixture({[PONS.factories[0]]:{error:{code:-32005,message:'provider capacity'}}});
 await assert.rejects(pons.membership('https://rpc.example',[token],x.context),{code:'RADAR_PONS_MEMBERSHIP_UNAVAILABLE',detail:'RADAR_PONS_MEMBERSHIP_INCOMPLETE'});
 assert.equal(x.requests.length,1);assert.equal(x.requests[0].length,2+PONS.factories.length);
});
test('empty, truncated and mismatched positive structs remain unavailable even if other factories report absence',async()=>{
 for(const result of ['0x','0x'+'0'.repeat(64),positive(other)]){
  const x=fixture({[PONS.factories[0]]:result});
  await assert.rejects(pons.membership('https://rpc.example',[token],x.context),{code:'RADAR_PONS_MEMBERSHIP_UNAVAILABLE'});
  assert.equal(x.requests.length,1);
 }
});
test('one positive official factory record remains sufficient when another factory is unavailable',async()=>{
 const x=fixture({[PONS.factories[0]]:positive(token),[PONS.factories[1]]:{error:{code:-32000,message:'unavailable'}}});
 const result=await pons.membership('https://rpc.example',[token],x.context);
 assert.equal(result.members.get(token).factory,PONS.factories[0]);assert.equal(result.checked,1);
 assert.equal(x.requests.length,2,'existing membership + V1 graduation batches only');
});
test('complete negative records still produce an honest empty set and later batch failure is never partial-as-complete',async()=>{
 const x=fixture({}),result=await pons.membership('https://rpc.example',[token],x.context);
 assert.equal(result.members.size,0);assert.equal(result.checked,1);assert.equal(x.requests.length,1);
 let count=0;const many=async()=>{count++;if(count===2)throw Error('temporary factory outage');return {members:new Map([[token,{factory:PONS.factories[0]}]])};};
 await assert.rejects(pons.membershipAll('https://rpc.example',[token,other],{}, {many,max:1}),/temporary factory outage/);
});

test('captured live V1/V2 factory structs retain two launches and reject both nonmember controls',async()=>{
 const captured=require('./fixtures/radar/pons-factory-shapes-20261127.json');
 assert.equal(captured.chainId,4663);assert.match(captured.block,/^0x[0-9a-f]+$/);
 let calls=0;
 const fetcher=async(_url,opts)=>{
  calls++;
  const body=JSON.parse(opts.body).map(c=>{
   if(c.method==='eth_chainId')return {jsonrpc:'2.0',id:c.id,result:'0x1237'};
   if(c.method==='eth_blockNumber')return {jsonrpc:'2.0',id:c.id,result:captured.block};
   const observation=captured.calls.find(x=>x.params[0].to===c.params[0].to&&x.params[0].data===c.params[0].data);
   if(!observation)return {jsonrpc:'2.0',id:c.id,error:{code:-32601,message:'Graduation not included in fixture'}};
   const answer=captured.responses.find(x=>x.id===observation.id);
   return {...answer,id:c.id};
  });
  return {ok:true,status:200,text:async()=>JSON.stringify(body)};
 };
 const result=await pons.membership('https://rpc.example',captured.tokens,{fetcher,now:()=>Date.parse('2026-11-27T04:00:00Z')});
 assert.deepEqual([...result.members.keys()].sort(),captured.tokens.slice(0,2).sort());
 assert.equal(result.checked,4);assert.equal(calls,2);
 for(const c of captured.calls){
  const raw=captured.responses.find(x=>x.id===c.id).result,version=PONS.versions[c.params[0].to];
  assert.equal(raw.length,version==='v2'?962:834,'real absent records include the complete V1/V2 ABI struct');
 }
});
