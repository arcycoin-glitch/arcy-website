'use strict';
// CI-only probe: runs the PRODUCTION Pons V2 code (lib/radar-v2/pons.js) against the real Robinhood Chain RPC.
// Reports: V2 TokenLaunched events found, phase distribution (getLaunchedToken), curve progress, and a negative control.
const pons=require('../lib/radar-v2/pons'),{PONS}=require('../lib/radar-v2/sources');
const RPC=process.env.ROBINHOOD_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const V2=PONS.factories.find(f=>PONS.versions[f]==='v2');
const lines=[];const log=m=>{lines.push(m);console.log(m);};
let n=0,r429=0;
// CI-only pacing: 350 ms between calls and up to 4 retries on HTTP 429 (production code itself stays fail-closed).
const ctx={fetcher:async(u,o)=>{for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,350+i*2000));n++;const res=await fetch(u,{...o,signal:AbortSignal.timeout(20000)});if(res.status!==429)return res;r429++;}return fetch(u,{...o,signal:AbortSignal.timeout(20000)});},now:Date.now};
(async()=>{
 process.on('exit',()=>{});
 const rec=await pons.recentLaunches(RPC,ctx,{maxWindows:8,enough:60,maxLaunches:60});
 const v2=rec.launches.filter(l=>l.version==='v2'),v1=rec.launches.filter(l=>l.version==='v1');
 log('head block '+rec.block+' | windows used '+rec.windowsUsed+' x '+rec.windowBlocks+' blocks | status '+rec.status+' | requests '+rec.requests);
 log('events: V2='+v2.length+' (factory '+V2.slice(0,10)+') V1='+v1.length+' | perFactory '+Object.entries(rec.perFactory).map(([f,x])=>f.slice(0,8)+':'+x.version+':'+x.logs).join(','));
 if(v2.length){log('V2 newest launch '+v2[v2.length-1].time+' | oldest in scan '+v2[0].time);}
 const toks=v2.slice(-40).map(l=>l.token).reverse();
 const m=await pons.membershipMany(RPC,toks,ctx);
 const ph={};for(const [t,x] of m.members){const k=x.version+':'+(pons.PHASES[x.phase]||'v1');ph[k]=(ph[k]||0)+1;}
 log('membership of newest '+toks.length+' V2 event tokens: confirmed '+m.members.size+'/'+toks.length+' | phases '+JSON.stringify(ph)+' | rpc requests '+m.requests);
 const curves=[...m.members].filter(([,x])=>x.version==='v2'&&x.phase===0).slice(0,10).map(([t,x])=>({token:t,curve:x.curve}));
 const cs=await pons.curveStates(RPC,curves,ctx);
 log('curve-phase tokens read: '+cs.size+' | progress% '+[...cs.values()].map(x=>x.progressPct).join(','));
 // negative control: the V2 factory must NOT confirm an unrelated address
 const neg=await pons.membershipMany(RPC,['0x0bd7d308f8e1639fab988df18a8011f41eacad73','0x000000000000000000000000000000000000dead'],ctx);
 log('negative control (WETH, dead): confirmed='+neg.members.size+' (expected 0)');
 console.log('::notice title=pons-v2-probe::'+lines.join('\n').replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A'));
})().catch(e=>{log('FAIL '+(e.code||e.message)+' after '+n+' http calls, '+r429+' x429');console.log('::notice title=pons-v2-probe::'+lines.join('\n').replace(/%/g,'%25').replace(/\n/g,'%0A'));});
