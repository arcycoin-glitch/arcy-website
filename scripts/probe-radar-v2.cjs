'use strict';
// CI-only live probe for Radar V2 sources. Paced under GeckoTerminal's keyless 5 calls/minute; no keys are used or logged.
// Emits only status/shape facts (no raw provider data) as workflow annotations + step summary. Exit 1 on a hard contract break.
const fs=require('fs');
const radar=require('../lib/radar-v2'),gecko=require('../lib/radar-v2/gecko'),dexs=require('../lib/radar-v2/dexscreener'),pons=require('../lib/radar-v2/pons'),S=require('../lib/radar-v2/sources');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const lines=[];
const log=(level,msg)=>{lines.push(level+' '+msg);console.log(level+' '+msg);console.log('::notice title=radar-v2-probe::'+msg.replace(/[\r\n%]/g,' '));};
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
 const probes=[['robinhood',KNOWN.robinhood],['arc',KNOWN.arc],['arc',KNOWN.arcy],['ethereum','0xdac17f958d2ee523a2206206994597c13d831ec7']];
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
 // 4) End-to-end library run for each section (keyless, in-process only; nothing is served or published)
 const env={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'};
 for(const net of ['arc','ethereum','robinhood','pons']){
  await sleep(13000);
  try{
   const out=await radar.load(net,{env,rpcUrl:RPC,disableCache:true});
   const c=out.coverage;
   log('E2E',net+': tokens='+out.tokens.length+' crossCheck='+c.crossCheckProvider+' cross='+c.fieldsCrossVerified+' reported='+c.fieldsSourceReported+' notVerified='+c.fieldsNotVerified+' usage='+JSON.stringify(out.usage)+(net==='pons'?' ponsChecked='+c.ponsChecked+' confirmed='+c.ponsConfirmed:''));
  }catch(e){log('E2E',net+': FAIL '+e.code+(e.detail?' '+e.detail:''));if(net!=='pons')bad++;}
 }
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'### Radar V2 live probe\n```\n'+lines.join('\n')+'\n```\n');
 if(bad)process.exitCode=1;
})();
