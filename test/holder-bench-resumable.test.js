'use strict';
// #262: checkpointed holder benchmark — interrupted-run recovery, deterministic resumption, tamper/reorg rejection, exactness.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const B=require('../scripts/holder-bench-resumable.cjs');
const TOKEN='0x'+'7'.repeat(40),T=B.TRANSFER,pad=a=>'0x'+'0'.repeat(24)+a.slice(2),addr=i=>'0x'+i.toString(16).padStart(40,'0');
function chain({deploy=1000,head=21000,holders=40,hash='0xpin'}={}){
 // deterministic transfers: mint to holders, then some moves; balances tracked to make an exact supply
 const logs=[],bal=new Map();let supply=0n;
 for(let i=1;i<=holders;i++){const b=deploy+i*400;logs.push({b,from:'0x'+'0'.repeat(40),to:addr(i),v:BigInt(i)*1000n});bal.set(addr(i),BigInt(i)*1000n);supply+=BigInt(i)*1000n;}
 for(let i=1;i<holders;i+=3){const b=deploy+holders*400+i*50,v=BigInt(i)*10n;logs.push({b,from:addr(i),to:addr(i+1),v});bal.set(addr(i),bal.get(addr(i))-v);bal.set(addr(i+1),bal.get(addr(i+1))+v);}
 const calls={n:0,getLogs:0};let pinHash=hash;
 const rpc=async(m,p)=>{calls.n++;
  if(m==='eth_blockNumber')return '0x'+head.toString(16);
  if(m==='eth_getBlockByNumber')return {hash:Number(BigInt(p[0]))===head?pinHash:'0xother'};
  if(m==='eth_getCode')return Number(BigInt(p[1]))>=deploy?'0x60':'0x';
  if(m==='eth_getLogs'){calls.getLogs++;const f=Number(BigInt(p[0].fromBlock)),t=Number(BigInt(p[0].toBlock));return logs.filter(l=>l.b>=f&&l.b<=t).map(l=>({topics:[T,pad(l.from),pad(l.to)],removed:false}));}
  if(m==='eth_call'){if(p[0].data==='0x18160ddd')return '0x'+supply.toString(16);const a='0x'+p[0].data.slice(-40);return '0x'+(bal.get(a)||0n).toString(16);}
  throw Error(m);};
 return {rpc,calls,supply,setPinHash:h=>{pinHash=h;}};
}
const tmp=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'hb-')),'s.json');
test('uninterrupted run: full scan + exact reconciliation at one pinned block',async()=>{
 const c=chain(),file=tmp();
 const r=await B.run({token:TOKEN,rpc:c.rpc,file,window:500,deadlineMs:Infinity});
 assert.equal(r.phase,'DONE');assert.equal(r.state.result.exact,true);assert.equal(r.state.result.totalSupply,c.supply.toString());assert.equal(r.state.result.anchorStable,true);
});
test('interrupted run resumes from the durable checkpoint, rescans nothing, and reaches the identical result',async()=>{
 const ref=chain(),refR=await B.run({token:TOKEN,rpc:ref.rpc,file:tmp(),window:500,deadlineMs:Infinity});
 const c=chain(),file=tmp();let clock=0;const now=()=>clock;
 const slow=async(m,p)=>{clock++;return c.rpc(m,p);};
 const first=await B.run({token:TOKEN,rpc:slow,file,window:500,deadlineMs:20+18,now,saveEvery:1});   // "crash" by deadline mid-scan
 assert.equal(first.phase,'SCAN');const done=first.state.scan.windows;assert.ok(done>0&&done<40);
 const logsBefore=c.calls.getLogs;
 const second=await B.run({token:TOKEN,rpc:c.rpc,file,window:500,deadlineMs:Infinity});
 assert.equal(second.resumed,true);assert.equal(second.phase,'DONE');
 assert.equal(c.calls.getLogs-logsBefore,refR.state.scan.windows-done,'only the remaining windows are scanned');
 assert.deepEqual(second.state.result,refR.state.result,'deterministic result after resumption');
});
test('a tampered, reorged or foreign checkpoint is rejected and never trusted partially',async()=>{
 const c=chain(),file=tmp();let clock=0;
 await B.run({token:TOKEN,rpc:async(m,p)=>{clock++;return c.rpc(m,p);},file,window:500,deadlineMs:30,now:()=>clock,saveEvery:1});
 const body=JSON.parse(fs.readFileSync(file,'utf8'));
 fs.writeFileSync(file,JSON.stringify({...body,scan:{...body.scan,nextFrom:body.scan.nextFrom+500}}));
 assert.equal((await B.loadValid(file,{token:TOKEN,chainId:5042,window:500,rpc:c.rpc})).reason,'CHECKSUM_MISMATCH');
 fs.writeFileSync(file,JSON.stringify(body));
 assert.equal((await B.loadValid(file,{token:'0x'+'8'.repeat(40),chainId:5042,window:500,rpc:c.rpc})).reason,'IDENTITY_MISMATCH');
 c.setPinHash('0xreorged');
 assert.equal((await B.loadValid(file,{token:TOKEN,chainId:5042,window:500,rpc:c.rpc})).reason,'PINNED_BLOCK_REORGED');
});
test('inexact reconciliation is reported as not exact (never VERIFIED)',async()=>{
 const c=chain(),file=tmp();
 const lossy=async(m,p)=>{if(m==='eth_call'&&p[0].data==='0x18160ddd')return '0x'+(c.supply+1n).toString(16);return c.rpc(m,p);};
 const r=await B.run({token:TOKEN,rpc:lossy,file,window:500,deadlineMs:Infinity});
 assert.equal(r.state.result.exact,false);
});
test('RPC wrapper: 429/503 and -32005 are retried with backoff; persistent failure surfaces',async()=>{
 let n=0;const fetchImpl=async()=>{n++;if(n<3)return {status:429,headers:{get:()=>'0'},json:async()=>({})};return {status:200,json:async()=>({result:'0x1'})};};
 const {rpc,stats}=B.makeRpc(['http://x'],{paceMs:0,fetchImpl});
 assert.equal(await rpc('eth_blockNumber',[]),'0x1');assert.equal(stats.rateLimited,2);
 const dead=B.makeRpc(['http://x'],{paceMs:0,maxAttempts:2,fetchImpl:async()=>({status:503,headers:{get:()=>null},json:async()=>({})})});
 await assert.rejects(dead.rpc('eth_blockNumber',[]));
});
