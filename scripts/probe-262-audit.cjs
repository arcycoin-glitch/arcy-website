'use strict';
// Issue #262 read-only Production audit (CI only). Public site API only, same-origin headers, paced, no keys, no writes.
// Emits one "M262 <json>" log line per observation so the full matrix can be reconstructed from the job log.
//  1. 20-field matrix per representative token on Arc / Ethereum / Robinhood + adverse cases (invalid, wrong chain).
//  2. Live Trading cross-check: every ARCY trade row vs the provider's own trade feed for the same pool (tx hash, side).
//  3. Holder job states for the Arc tokens ARCY research has seen (identifies HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED jobs).
//  4. API latency p50/p95 with explicit sample sizes.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const H={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out=o=>console.log('M262 '+JSON.stringify(o));
async function get(u,headers=H){const t=Date.now();try{const r=await fetch(u,{headers,signal:AbortSignal.timeout(90000)});const txt=await r.text();let json=null;try{json=JSON.parse(txt);}catch{}
 return {status:r.status,ms:Date.now()-t,json,bytes:txt.length,retryAfter:r.headers.get('retry-after'),cache:r.headers.get('x-vercel-cache'),age:r.headers.get('age')};}catch(e){return {status:0,ms:Date.now()-t,error:String(e.message).slice(0,100)};}}
const TOKENS=[
 ['arc','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b','ARCY'],['arc','0xece5ca8bf9220718e5727754026757512212cb3c','ARGUS-TAX'],
 ['arc','0xbc43ce8dec648ea298c4275559b81d6261c90b67','TOLLY'],['arc','0xf76b1d00bd3d63a37246b5f512074e864010e33d','POLL'],
 ['ethereum','0x6982508145454ce325ddbe47a25d4ec3d2311933','PEPE'],['ethereum','0x1f9840a85d5af5bf1d1762f925bdaddc4201f984','UNI'],
 ['ethereum','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48','USDC-ETH'],
 ['robinhood','0x18e674231a58c239dc7daedcffe15ec3a24cff5c','UERC20'],['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571','PONS-L'],
 ['robinhood','0x6dbe95076584f869dd09a44131e9a3c13f34d7d6','PONS-V2']];
const ADVERSE=[['arc','0x123','INVALID_ADDRESS'],['ethereum','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b','WRONG_CHAIN_ARCY_ON_ETH'],['arc','0x000000000000000000000000000000000000dead','NO_CODE']];
const short=v=>v===null||v===undefined?null:typeof v==='object'?JSON.stringify(v).slice(0,80):String(v).slice(0,80);
function fields(report){
 const rows=[];
 for(const [card,body] of Object.entries(report?.cards||{}))for(const [key,f] of Object.entries(body?.fields||{})){
  if(!f||typeof f!=='object')continue;
  rows.push({card,key,value:short(f.value),status:f.status||null,dataState:f.dataState||null,evidenceState:f.evidenceState||null,evidenceClass:f.evidenceClass||null,
   reason:f.reasonCode||f.provenance?.failureReason||null,asOf:f.provenance?.asOf||null,block:f.provenance?.block||f.snapshot?.block||null,
   sources:(f.provenance?.sources||[]).slice(0,4),conflict:f.provenance?.conflict?true:false});
 }
 return rows;
}
(async()=>{
 const lat={report:[],trades:[],radar:[]};
 // 1. matrix
 for(const [chain,address,label] of TOKENS){
  const r=await get(BASE+'/api/search?action=report&chain='+chain+'&address='+address);lat.report.push(r.ms);
  const rep=r.json?.report||r.json;const f=fields(rep);
  out({kind:'report',label,chain,address,http:r.status,ms:r.ms,bytes:r.bytes,ok:rep?.ok??null,fieldCount:f.length,stateTotal:rep?.evidenceSummary?.stateTotal||null,fields:f});
  await sleep(2500);
 }
 for(const [chain,address,label] of ADVERSE){
  const r=await get(BASE+'/api/search?action=report&chain='+chain+'&address='+address);
  const rep=r.json?.report||r.json;
  out({kind:'adverse',label,chain,address,http:r.status,error:r.json?.error||null,reason:r.json?.reasonCode||null,
   fieldsWithValue:fields(rep).filter(x=>x.value!==null&&x.evidenceState!=='NOT_VERIFIED').length,verified:fields(rep).filter(x=>x.evidenceState==='VERIFIED').length});
  await sleep(2000);
 }
 // 2. live trading cross-check against GeckoTerminal's own trade feed for the same pool (independent indexer)
 for(const [chain,address,label] of TOKENS.filter(t=>['POLL','TOLLY','ARGUS-TAX','PEPE','UERC20'].includes(t[2]))){
  const r=await get(BASE+'/api/search?action=trades&chain='+chain+'&address='+address);lat.trades.push(r.ms);
  const d=r.json||{},trades=d.trades||[];
  const gt={arc:'arc',ethereum:'eth',robinhood:'robinhood'}[chain],byPool=new Map();
  for(const p of [...new Set(trades.map(t=>t.pool))].slice(0,3)){
   if(!/^0x[0-9a-f]{40}$/.test(p))continue;   // V4 pool ids are not addressable on the provider trade feed
   const g=await get('https://api.geckoterminal.com/api/v2/networks/'+gt+'/pools/'+p+'/trades',{accept:'application/json'});await sleep(2500);
   byPool.set(p,new Map((g.json?.data||[]).map(x=>[String(x.attributes.tx_hash).toLowerCase(),x.attributes])));
  }
  const rows=trades.map(t=>{const g=byPool.get(t.pool)?.get(t.txHash);
   return {tx:t.txHash,block:t.block,ts:t.timestamp,side:t.side,wallet:t.wallet,pool:t.pool,protocol:t.protocol,verification:t.verification,usd:t.usd,usdStatus:t.usdStatus,tokenAmount:t.tokenAmount,counter:t.counterAmount+' '+t.counterSymbol,
    provider:g?{kind:g.kind,from:String(g.tx_from_address||'').toLowerCase(),usd:Number(g.volume_in_usd)}:null};});
  const checked=rows.filter(x=>x.provider),sideAgree=checked.filter(x=>x.side.toLowerCase()===x.provider.kind).length,walletAgree=checked.filter(x=>x.wallet===x.provider.from).length;
  const dup=rows.length-new Set(rows.map(x=>x.tx+':'+x.block+':'+x.side+':'+x.tokenAmount)).size;
  out({kind:'trades',label,chain,http:r.status,ms:r.ms,status:d.status,reason:d.reasonCode||null,n:rows.length,observedAt:d.observedAt,lastTradeAt:d.lastTradeAt,
   reconciliation:d.reconciliation||null,coverage:d.coverage||null,providerChecked:checked.length,sideAgree,walletAgree,duplicates:dup,rows:rows.slice(0,8)});
  await sleep(2000);
 }
 // 3. holder job states (Arc)
 for(const [chain,address,label] of TOKENS.filter(t=>t[0]==='arc')){
  const r=await get(BASE+'/api/holders?action=status&address='+address);out({kind:'holderJob',label,address,http:r.status,job:r.json?.job||r.json||null});await sleep(1500);
 }
 {const radar=await get(BASE+'/api/search?action=radar&chain=arc');lat.radar.push(radar.ms);
  const cands=[...(radar.json?.tokens||[]).map(t=>[t.symbol,t.address]),...(radar.json?.excluded||[]).slice(0,25).map(t=>[t.symbol,t.address])];
  for(const [sym,a] of cands){if(!/^0x[0-9a-f]{40}$/.test(a))continue;const r=await get(BASE+'/api/holders?action=status&address='+a);const j=r.json?.job||null;
   if(j&&(j.state==='FAILED'||j.state==='UNSUPPORTED'))out({kind:'holderJobFailing',symbol:sym,address:a,job:j});await sleep(800);}
  const status=await get(BASE+'/api/status');out({kind:'status',http:status.status,worker:status.json?.worker||null,risk:status.json?.worker?.risk||status.json?.risk||null});}
 // 4. latency samples (sequential, paced; warm/edge-cache effects reported via x-vercel-cache)
 for(let i=0;i<6;i++){for(const [chain,address] of [['ethereum','0x6982508145454ce325ddbe47a25d4ec3d2311933'],['arc','0xece5ca8bf9220718e5727754026757512212cb3c']]){
  const r=await get(BASE+'/api/search?action=trades&chain='+chain+'&address='+address);lat.trades.push(r.ms);out({kind:'latSample',endpoint:'trades',chain,ms:r.ms,cache:r.cache,http:r.status});
  const q=await get(BASE+'/api/search?action=report&chain='+chain+'&address='+address);lat.report.push(q.ms);out({kind:'latSample',endpoint:'report',chain,ms:q.ms,cache:q.cache,http:q.status});}
  for(const chain of ['arc','ethereum','robinhood']){const r=await get(BASE+'/api/search?action=radar&chain='+chain);lat.radar.push(r.ms);out({kind:'latSample',endpoint:'radar',chain,ms:r.ms,http:r.status,cache:r.cache,reason:r.json?.reasonCode||null,retryAfter:r.retryAfter});}
  await sleep(4000);}
 const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.ceil(p/100*s.length)-1)]:null;};
 out({kind:'latency',report:{n:lat.report.length,p50:pct(lat.report,50),p95:pct(lat.report,95)},trades:{n:lat.trades.length,p50:pct(lat.trades,50),p95:pct(lat.trades,95)},radar:{n:lat.radar.length,p50:pct(lat.radar,50),p95:pct(lat.radar,95)}});
})();
