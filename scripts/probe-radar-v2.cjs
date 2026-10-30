'use strict';
// CI-only live probe for Radar V2 sources. Paced under GeckoTerminal's keyless 5 calls/minute; no keys are used or logged.
// Emits only status/shape facts (no raw provider data) as workflow annotations + step summary. Exit 1 on a hard contract break.
const fs=require('fs');
const radar=require('../lib/radar-v2'),gecko=require('../lib/radar-v2/gecko'),dexs=require('../lib/radar-v2/dexscreener'),pons=require('../lib/radar-v2/pons'),S=require('../lib/radar-v2/sources');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const lines=[];
const log=(level,msg)=>{lines.push(level+' '+msg);console.log(level+' '+msg);};
const KNOWN={robinhood:'0x39dbed3a2bd333467115de45665cc57f813c4571',arc:'0xf76b1d00bd3d63a37246b5f512074e864010e33d',arcy:'0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b'};
const RPC=process.env.ROBINHOOD_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
(async()=>{
 let bad=0;const access={mode:'keyless',host:'https://api.geckoterminal.com/api/v2',header:null,key:null};
 // 1) GeckoTerminal network ids
 for(const net of ['arc','ethereum','robinhood']){
  try{const body=await gecko.fetchPage(access,net,'top',1,{});const p=gecko.parse(body,net);log('GT',net+' ('+S.NETWORKS[net].gecko+'): HTTP ok, '+body.data.length+' pools, '+p.rows.length+' contract-matched rows');if(!p.rows.length)bad++;}
  catch(e){bad++;log('GT',net+': FAIL '+e.code+(e.detail?' '+e.detail:''));}
  await sleep(13000);
 }
 // 2) DEX Screener chain ids with known tokens + control
 const probes=[['robinhood',KNOWN.robinhood],['arc',KNOWN.arc],['arc',KNOWN.arcy],['ethereum','0x1f9840a85d5af5bf1d1762f925bdaddc4201f984']];
 for(const [net,a] of probes){
  try{const m=await dexs.tokens(net,[a],{});const pairs=m.get(a.toLowerCase())||[];log('DS',net+' slug "'+S.NETWORKS[net].dex+'" token '+a.slice(0,8)+': '+pairs.length+' pair(s)'+(pairs[0]?' liq='+pairs[0].liquidityUsd:''));if(net==='ethereum'&&!pairs.length)bad++;}
  catch(e){log('DS',net+' slug "'+S.NETWORKS[net].dex+'": FAIL '+e.code);}
 }
 // 3) Pons factory read on a real launch + a negative control (WETH is not a launched token)
 try{
  const out=await pons.membership(RPC,[KNOWN.robinhood,S.PONS.weth],{});
  const m=out.members.get(KNOWN.robinhood);
  log('PONS','block '+out.block+'; PONS token member='+Boolean(m)+(m?' factory='+m.factory+' graduated='+(m.graduation&&m.graduation.graduated):'')+'; WETH member='+out.members.has(S.PONS.weth));
  if(!m||out.members.has(S.PONS.weth))bad++;
 }catch(e){bad++;log('PONS','FAIL '+e.code+(e.detail?' '+e.detail:''));}
 // 4) End-to-end library run for each section (keyless, in-process only; nothing is served or published).
 // Provider pages are cached across sections exactly as in production (Pons reuses the Robinhood top-volume page).
 const env={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'};
 const slow=async(u,o)=>{if(/geckoterminal/.test(u))await sleep(14000);return fetch(u,{...o,signal:AbortSignal.timeout(9000)});};
 const FIELDS=['priceUsd','volume24hUsd','liquidityUsd','change24hPct','fdvUsd','marketCapUsd','poolCreatedAt'];
 const tot={tokens:0,logos:0,present:0,cross:0,cells:0};
 for(const net of ['arc','ethereum','robinhood','pons']){
  try{
   let out;
   try{out=await radar.load(net,{env,rpcUrl:RPC,fetcher:slow});}
   catch(e){if(e.code!=='RADAR_PROVIDER_RATE_LIMITED')throw e;log('E2E',net+': 429, retrying once after 90s');await sleep(90000);require('../lib/radar-v2/http')._resetCooldowns();out=await radar.load(net,{env,rpcUrl:RPC,fetcher:slow});}
   const c=out.coverage,n=out.tokens.length;let present=0,cross=0;const miss={};
   for(const t of out.tokens)for(const f of FIELDS){const st=t.fields[f].status;if(st!=='NOT_VERIFIED')present++;else{const k=f+':'+t.fields[f].reasonCode;miss[k]=(miss[k]||0)+1;}if(st==='CROSS_VERIFIED'||st==='ONCHAIN_VERIFIED')cross++;}
   Object.assign(tot,{tokens:tot.tokens+n,logos:tot.logos+out.tokens.filter(t=>t.logo).length,present:tot.present+present,cross:tot.cross+cross,cells:tot.cells+n*FIELDS.length});
   log('E2E',net+': tokens='+n+' logos='+c.logos+' present='+present+'/'+n*FIELDS.length+' cross='+cross+'/'+n*FIELDS.length+' tokenStats='+c.tokenStats+' crossCheck='+c.crossCheckProvider+' usage='+JSON.stringify(out.usage)+(net==='pons'?' ponsChecked='+c.ponsChecked+' confirmed='+c.ponsConfirmed:'')+' missing='+JSON.stringify(miss));
   // Annotation messages are capped (~4 KB): emit a compact, UI-replayable form in chunks.
   const compact=out.tokens.map(t=>({k:t.rank,y:t.symbol,n:t.name,a:t.address,l:t.logo?[t.logo.url,t.logo.source]:null,
    f:Object.fromEntries(FIELDS.map(f=>[f,[t.fields[f].value,t.fields[f].status[0],t.fields[f].scope||t.fields[f].reasonCode||t.fields[f].crossCheck||'']])),
    ...(t.launch?{g:[t.launch.status,t.graduation&&t.graduation.graduated===true]}:{})}));
   const chunks=[];let cur=[];
   for(const t of compact){if(JSON.stringify([...cur,t]).length>3500&&cur.length){chunks.push(cur);cur=[];}cur.push(t);}if(cur.length)chunks.push(cur);
   chunks.forEach((c,i)=>console.log('::notice title=radar-json-'+net+'-'+i+'::'+JSON.stringify({net,i,asOf:out.asOf,t:c}).replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A')));
  }catch(e){log('E2E',net+': FAIL '+e.code+(e.detail?' '+e.detail:''));if(net!=='pons')bad++;}
 }
 log('TOTAL','tokens='+tot.tokens+' logo='+(100*tot.logos/Math.max(1,tot.tokens)).toFixed(1)+'% completeness='+(100*tot.present/Math.max(1,tot.cells)).toFixed(1)+'% cross='+(100*tot.cross/Math.max(1,tot.cells)).toFixed(1)+'%');
 // GitHub caps annotations at 10 per step, so publish ONE multi-line notice.
 console.log('::notice title=radar-v2-probe::'+lines.join('\n').replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A'));
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'### Radar V2 live probe\n```\n'+lines.join('\n')+'\n```\n');
 if(bad)process.exitCode=1;
})();
