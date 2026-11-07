#!/usr/bin/env node
'use strict';
// BOUNDED read-only Arc 5042 holder incident probe for GitHub #187.
// Maximum 25 RPC calls, no writes, no queue or worker mutations; no source auth/bypass.
const RPC='https://rpc.mainnet.arc.io',MAX=25,TIMEOUT=14000;
const tokens=[
 {a:'0x425ecb63957c78bec278d71cffd49a873dba7777',type:'DISCOVER_ZERO'},
 {a:'0x0dc6b79f3c3854e4d74514fd4d29be6c96beee39',type:'DISCOVER_ZERO'},
 {a:'0xbbe6aab0ed76e90aea0d1cd978ec231c8adcdf8b',type:'DISCOVER_SPAN'},
 {a:'0x5bc5ced48bec9260c8d626269f44e22808b8d2c1',type:'GETTER_REVERTED'},
 {a:'0xf89005ccf237a59eeee1521e74b15c7d8d022ab7',type:'GETTER_REVERTED'}
];
const dead='0x000000000000000000000000000000000000dead';
let calls=0;
async function rpc(method,params){
 if(++calls>MAX)throw Error('PROBE_CALL_CAP_REACHED');
 try{
  const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:calls,method,params}),signal:AbortSignal.timeout(TIMEOUT)});
  const d=await r.json().catch(()=>({}));
  return {http:r.status,ok:r.ok&&!d.error,code:d.error?.code||null,error:String(d.error?.message||'').slice(0,145),result:d.result};
 }catch(e){return {ok:false,error:String(e.code||e.message).slice(0,145)}}
}
const compact=(r,code=false)=>({http:r.http,ok:r.ok,code:r.code,error:r.error,result:r.ok?(code?'nonempty-runtime='+Boolean(r.result&&r.result!=='0x'):String(r.result).slice(0,70)):undefined});
const hex=n=>'0x'+n.toString(16);
(async()=>{
 const chain=await rpc('eth_chainId',[]),head=await rpc('eth_blockNumber',[]);
 if(chain.result!=='0x13b2'||!head.ok)throw Error('Wrong chain or head unavailable: '+JSON.stringify({chain,head}));
 const bn=Number(BigInt(head.result)),older=hex(Math.max(1,bn-10000000)),prior=hex(Math.max(1,bn-1000000));
 const rows=[];for(const t of tokens){
  const out={address:t.a,type:t.type,head:bn,checks:{}};
  let x=await rpc('eth_getCode',[t.a,'latest']);out.checks.codeNow=compact(x,true);
  if(t.type==='GETTER_REVERTED'){
   x=await rpc('eth_call',[{to:t.a,data:'0x18160ddd'},'latest']);out.checks.totalSupply=compact(x);
   x=await rpc('eth_call',[{to:t.a,data:'0x70a08231'+dead.slice(2).padStart(64,'0')},'latest']);out.checks.balanceOfDead=compact(x);
   x=await rpc('eth_call',[{to:t.a,data:'0x70a08231'+t.a.slice(2).padStart(64,'0')},'latest']);out.checks.balanceOfSelf=compact(x);
  }else{
   x=await rpc('eth_getCode',[t.a,older]);out.checks.codeAtHeadMinus10m=compact(x,true);
   if(t.type==='DISCOVER_ZERO'){x=await rpc('eth_getCode',[t.a,prior]);out.checks.codeAtHeadMinus1m=compact(x,true);}
  }
  rows.push(out);console.log('PROBE_ROW '+JSON.stringify(out));
 }
 const report={at:new Date().toISOString(),provider:RPC,chainId:chain.result,head:bn,calls,maxCalls:MAX,rows};
 require('node:fs').writeFileSync('arc-holder-five-probe.json',JSON.stringify(report,null,2));
 console.log('::notice title=arc-holder-bounded-probe::'+JSON.stringify({chainId:chain.result,head:bn,calls,rows:rows.map(x=>({type:x.type,address:x.address,checks:x.checks}))}).slice(0,2700));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
