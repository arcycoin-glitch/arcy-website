#!/usr/bin/env node
'use strict';
// Read-only: compare the PUBLISHED holder snapshot of one contract with an independent Transfer-log scan + balanceOf
// reads pinned at the SAME block the publication states. Never queues, never writes.
const RPC=process.env.ARC_RPC_URL||'https://rpc.mainnet.arc.io',BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const A=(process.env.PROBE_CONTRACT||'').toLowerCase(),DEPLOY=Number(process.env.PROBE_DEPLOY_BLOCK),WIN=2000;
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',BURNS=new Set(['0x'+'0'.repeat(40),'0x000000000000000000000000000000000000dead']);
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),hex=n=>'0x'+n.toString(16);let id=0,calls=0,r429=0;
async function rpc(method,params){for(let i=0;i<10;i++){calls++;const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)}).catch(()=>null);if(!r||r.status===429||r.status>=500){if(r?.status===429)r429++;await sleep(1000*2**Math.min(i,4));continue;}const d=await r.json();if(d.error)throw new Error(method+': '+d.error.message);await sleep(120);return d.result;}throw new Error(method+': retries exhausted');}
async function get(p){const r=await fetch(BASE+p,{headers:{accept:'application/json'},signal:AbortSignal.timeout(30000)});return {http:r.status,d:await r.json().catch(()=>null)};}
(async()=>{
 const pub=await get('/api/holders?address='+A),st=await get('/api/holders?address='+A+'&action=status');
 const p=pub.d||{},ev=Array.isArray(p.evidence)?p.evidence[0]:p.evidence;
 console.log('::notice title=publication::'+JSON.stringify({http:pub.http,keys:Object.keys(p),holderCount:p.holderCount,block:p.block??ev?.block,completedAt:p.completedAt,reasonCode:p.reasonCode,largestWalletPct:p.largestWalletPct,top10Pct:p.top10Pct,evidence:ev?{source:ev.source,block:ev.block,blockHash:ev.blockHash,totalSupplyRaw:ev.totalSupplyRaw,candidates:ev.candidates??ev.candidateAddresses,candidateDiscovery:ev.candidateDiscovery}:null,job:st.d?.job}).slice(0,4000));
 const raw=p.block??ev?.block;const B=typeof raw==='string'?Number(BigInt(raw)):Number(raw);
 if(!Number.isSafeInteger(B)||!Number.isSafeInteger(DEPLOY))throw new Error('no published block to pin: '+raw);
 const cand=new Set();let transfers=0;
 for(let f=DEPLOY-1;f<=B;f+=WIN){const t=Math.min(B,f+WIN-1);const logs=await rpc('eth_getLogs',[{address:A,topics:[TRANSFER],fromBlock:hex(f),toBlock:hex(t)}]);for(const l of logs){transfers++;cand.add('0x'+l.topics[1].slice(-40));cand.add('0x'+l.topics[2].slice(-40));}}
 const tag=hex(B),supply=BigInt(await rpc('eth_call',[{to:A,data:'0x18160ddd'},tag]));let sum=0n,pos=0,posEx=0;const bal=[];
 for(const x of cand){if(x==='0x'+'0'.repeat(40))continue;const v=BigInt(await rpc('eth_call',[{to:A,data:'0x70a08231'+'0'.repeat(24)+x.slice(2)},tag]));sum+=v;if(v>0n){pos++;if(!BURNS.has(x)){posEx++;bal.push(v);}}}
 bal.sort((a,b)=>a<b?1:a>b?-1:0);const pct=v=>Number(v*1000000n/supply)/10000;
 console.log('::notice title=independent::'+JSON.stringify({block:B,transfers,candidates:cand.size,totalSupplyRaw:supply.toString(),sumRaw:sum.toString(),exact:sum===supply,positive:pos,positiveExBurn:posEx,largestPct:bal.length?pct(bal[0]):null,top10Pct:pct(bal.slice(0,10).reduce((a,b)=>a+b,0n)),calls,http429:r429,matchesPublished:posEx===Number(p.holderCount)}));
})().catch(e=>{console.log('::error title=publication-probe::'+e.message);process.exitCode=1;});
