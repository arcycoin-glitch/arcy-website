'use strict';
// pons membership + graduation by TARGETED eth_call reads only (no eth_getLogs, no history, no index).
// A token counts as a pons launch only if an official factory's getLaunchedToken(token) says exists==true for that exact token.
const keccak=require('../keccak');
const {PONS}=require('./sources');
const http=require('./http');
const sel=sig=>'0x'+keccak(Buffer.from(sig)).slice(2,10);
const SEL={getLaunchedToken:sel('getLaunchedToken(address)'),graduationStatus:sel('graduationStatus(address)')};
const word=(d,i)=>d.slice(2+i*64,2+(i+1)*64),addrOf=w=>'0x'+w.slice(-40).toLowerCase();
const calldata=(s,token)=>s+'0'.repeat(24)+token.slice(2);
async function batch(rpcUrl,calls,{fetcher,now}){
 const body=calls.map((c,i)=>({jsonrpc:'2.0',id:i+1,...c}));
 const out=await http.request('pons-rpc',rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body,fetcher,now});
 if(!Array.isArray(out)||out.length!==body.length||new Set(out.map(x=>x?.id)).size!==body.length)throw http.fail('RADAR_PONS_RPC_BAD_BATCH');
 const byId=new Map(out.map(x=>[x.id,x]));
 return body.map(b=>byId.get(b.id));
}
// decode getLaunchedToken: 13 static words; word0 token, word1 deployer, word2 paired token, word11 exists
function decodeLaunch(raw,token){
 if(typeof raw!=='string'||!/^0x[0-9a-f]{832}$/i.test(raw))return null;
 if(BigInt('0x'+word(raw,11))!==1n||addrOf(word(raw,0))!==token)return null;
 return {deployer:addrOf(word(raw,1)),pairToken:addrOf(word(raw,2))};
}
// V2 getLaunchedToken: 15 static words. 0 token, 1 curve, 2 deployer, 4 pairToken, 5 graduationThreshold, 10 phase, 14 exists.
// phase: 0 bonding curve trading, 1 swept, 2 pool created (Uniswap v4 + meme hook), 3 rescued.
function decodeLaunchV2(raw,token){
 if(typeof raw!=='string'||!/^0x[0-9a-f]{960}$/i.test(raw))return null;
 if(BigInt('0x'+word(raw,14))!==1n||addrOf(word(raw,0))!==token)return null;
 const phase=Number(BigInt('0x'+word(raw,10)));
 if(!(phase>=0&&phase<=3))return null;
 return {version:'v2',deployer:addrOf(word(raw,2)),pairToken:addrOf(word(raw,4)),curve:addrOf(word(raw,1)),phase,graduationThresholdRaw:BigInt('0x'+word(raw,5)).toString()};
}
const PHASES=['BONDING_CURVE','SWEPT','GRADUATED_POOL','RESCUED'];
const graduationOfV2=d=>({phase:d.phase,phaseName:PHASES[d.phase],graduated:d.phase===2,onCurve:d.phase===0});
function decodeGraduation(raw){
 if(typeof raw!=='string'||!/^0x[0-9a-f]{192}$/i.test(raw))return null;
 return {pairedPrincipalEth:Number(BigInt('0x'+word(raw,0)))/1e18,thresholdEth:Number(BigInt('0x'+word(raw,1)))/1e18,graduated:BigInt('0x'+word(raw,2))===1n};
}
// -> Map(token -> {factory,deployer,pairToken,graduation|null}); throws RADAR_PONS_MEMBERSHIP_UNAVAILABLE if the RPC cannot answer.
async function membership(rpcUrl,tokens,{fetcher,now}){
 const list=[...new Set(tokens)].slice(0,PONS.maxCandidates);
 if(!list.length)return {members:new Map(),block:null,checked:0};
 try{
  const calls=[{method:'eth_chainId',params:[]},{method:'eth_blockNumber',params:[]}];
  for(const f of PONS.factories)for(const t of list)calls.push({method:'eth_call',params:[{to:f,data:calldata(SEL.getLaunchedToken,t)},'latest']});
  const res=await batch(rpcUrl,calls,{fetcher,now});
  if(res[0]?.result===undefined||Number(BigInt(res[0].result))!==4663)throw http.fail('RADAR_PONS_WRONG_CHAIN');
  const block=res[1]?.result&&/^0x[0-9a-f]+$/i.test(res[1].result)?Number(BigInt(res[1].result)):null;
  const members=new Map();let k=2;
  for(const f of PONS.factories)for(const t of list){const r=res[k++];if(!r||r.error||typeof r.result!=='string')continue;const v2=PONS.versions[f]==='v2',d=v2?decodeLaunchV2(r.result,t):decodeLaunch(r.result,t);if(d&&!members.has(t))members.set(t,{factory:f,version:v2?'v2':'v1',...d});}
  if(members.size){
   for(const [t,m] of members)if(m.version==='v2')m.graduation=graduationOfV2(m);
   const ids=[...members.keys()].filter(t=>members.get(t).version==='v1');
   if(ids.length){
    const g=await batch(rpcUrl,ids.map(t=>({method:'eth_call',params:[{to:members.get(t).factory,data:calldata(SEL.graduationStatus,t)},'latest']})),{fetcher,now});
    ids.forEach((t,i)=>{members.get(t).graduation=g[i]&&!g[i].error?decodeGraduation(g[i].result):null;});
   }
  }
  return {members,block,checked:list.length};
 }catch(e){
  if(e.code==='RADAR_PROVIDER_RATE_LIMITED')throw e;
  throw http.fail('RADAR_PONS_MEMBERSHIP_UNAVAILABLE',{detail:e.code||'ERROR'});
 }
}
// Up to PONS.maxChecked candidates, checked in sequential batches of PONS.maxCandidates. A failure in ANY batch fails the whole check
// (never a partial answer presented as complete). -> {members, block, checked, requests}
async function membershipMany(rpcUrl,tokens,ctx){
 const list=[...new Set(tokens)].slice(0,PONS.maxChecked),members=new Map();let block=null,checked=0,requests=0;
 for(let i=0;i<list.length;i+=PONS.maxCandidates){
  const m=await membership(rpcUrl,list.slice(i,i+PONS.maxCandidates),ctx);
  requests+=[...m.members.values()].some(x=>x.version==='v1')?2:1;checked+=m.checked;if(m.block!==null)block=m.block;
  for(const [t,v] of m.members)members.set(t,v);
 }
 return {members,block,checked,requests};
}
// Recent launches from each factory's own TokenLaunched event: bounded, topic-filtered eth_getLogs windows (stateless: no index, nothing stored).
// Windows walk BACKWARDS (newest first) until enough launches are found or maxWindows is used; a window halves if the RPC refuses its span / result cap.
// Purpose: find genuinely new launches that the data providers' top/trending/newest pool windows do not list yet.
const TOPIC_LAUNCHED='0x'+keccak(Buffer.from('TokenLaunched(address,address,address,address,address,uint256,uint256,uint256,uint256,uint256)')).slice(2);
const TOPIC_LAUNCHED_V2='0x'+keccak(Buffer.from('TokenLaunched(address,address,address,address,uint256,uint256)')).slice(2);
const RECENT_WINDOW_BLOCKS=8000000;       // ~10 days on a ~9.5 blocks/s chain; the RPC's own span cap is 10,000,000
function parseLog(l,f){
 const v2=PONS.versions[f]==='v2';
 if(!l||typeof l.address!=='string'||l.address.toLowerCase()!==f||!Array.isArray(l.topics)||typeof l.data!=='string')return null;
 if(v2){
  if(l.topics.length!==4||l.topics[0].toLowerCase()!==TOPIC_LAUNCHED_V2||!/^0x[0-9a-f]{192}$/i.test(l.data))return null;
  return {token:addrOf(l.topics[1]),factory:f,version:'v2',curve:addrOf(l.topics[2]),deployer:addrOf(l.topics[3]),pairToken:addrOf(word(l.data,0)),pool:null,block:Number(BigInt(l.blockNumber))};
 }
 if(l.topics.length!==4||!/^0x[0-9a-f]{448}$/i.test(l.data))return null;
 return {token:addrOf(l.topics[1]),factory:f,version:'v1',deployer:addrOf(l.topics[2]),pairToken:addrOf(word(l.data,0)),pool:addrOf(word(l.data,1)),block:Number(BigInt(l.blockNumber))};
}
// V2 launches are frequent, so its windows are small (newest first) and stop as soon as enough launches are found; the V1 factories are quiet
// (zero events in the last ~90 days when probed) and get one wide window. A window halves if the RPC refuses its span / result cap or the
// response would exceed the 1 MiB HTTP guard.
const V2_WINDOW_BLOCKS=500000;            // ~14.6 hours at ~9.5 blocks/s (a 1M window overflowed the 1 MiB response guard)
// launch time = the block's own timestamp (batched reads of 10 distinct blocks); mutates items with .time
async function blockTimes(rpcUrl,items,{fetcher,now},count=()=>{}){
 const blocks=[...new Set(items.map(l=>l.block))],ts=new Map();
 for(let k=0;k<blocks.length;k+=10){
  const part=blocks.slice(k,k+10),res=await batch(rpcUrl,part.map(b=>({method:'eth_getBlockByNumber',params:['0x'+b.toString(16),false]})),{fetcher,now});count(1);
  part.forEach((b,i)=>ts.set(b,res[i]?.result?.timestamp&&/^0x[0-9a-f]+$/i.test(res[i].result.timestamp)?Number(BigInt(res[i].result.timestamp))*1000:null));
 }
 for(const l of items)l.time=ts.get(l.block)?new Date(ts.get(l.block)).toISOString():null;
}
// Which of these V2 event tokens have already graduated (phase 2)? V2 factory only, batches of 30 eth_calls. Never partial-as-complete: a failed batch throws.
async function graduatedV2(rpcUrl,tokens,{fetcher,now}){
 const f=PONS.factories.find(x=>PONS.versions[x]==='v2'),out=new Map();let requests=0;
 for(let i=0;i<tokens.length;i+=30){
  const part=tokens.slice(i,i+30),res=await batch(rpcUrl,part.map(t=>({method:'eth_call',params:[{to:f,data:calldata(SEL.getLaunchedToken,t)},'latest']})),{fetcher,now});requests++;
  part.forEach((t,k)=>{const r=res[k];if(!r||r.error||typeof r.result!=='string')return;const d=decodeLaunchV2(r.result,t);if(d)out.set(t,{factory:f,...d,graduation:graduationOfV2(d)});});
 }
 return {members:out,requests};
}
// V2 graduations: factory event PoolGraduated(address indexed token,uint256,uint256,uint256) (topic0 confirmed against chain logs of known V2 tokens;
// the docs name the event but do not publish its signature). Sparse, so wide newest-first windows (RPC span cap 10M) are used.
const TOPIC_GRADUATED_V2='0x'+keccak(Buffer.from('PoolGraduated(address,uint256,uint256,uint256)')).slice(2);
async function recentGraduations(rpcUrl,{fetcher,now},{window=9500000,maxWindows=3,max=30}={}){
 const f=PONS.factories.find(x=>PONS.versions[x]==='v2');let requests=1;
 const head=await batch(rpcUrl,[{method:'eth_blockNumber',params:[]}],{fetcher,now});
 const B=Number(BigInt(head[0].result)),out=[];let to=B,w=window,status='OK';
 for(let i=0;i<maxWindows&&to>0&&out.length<max;i++){
  let got=null,from=0;
  for(let a=0;a<4&&got===null;a++){
   from=Math.max(0,to-w);
   let res;try{res=await batch(rpcUrl,[{method:'eth_getLogs',params:[{address:f,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16),topics:[TOPIC_GRADUATED_V2]}]}],{fetcher,now});requests++;}
   catch(e){if(e.code==='RADAR_PROVIDER_RESPONSE_TOO_LARGE'){w=Math.floor(w/2);status='WINDOW_REDUCED';continue;}throw e;}
   const r=res[0];
   if(r&&Array.isArray(r.result))got=r.result;
   else if(r&&r.error&&/span|limit|range|exceed|too many/i.test(String(r.error.message))){w=Math.floor(w/2);status='WINDOW_REDUCED';}
   else throw http.fail('RADAR_PONS_LOGS_UNAVAILABLE');
  }
  if(got===null){status='LOGS_UNAVAILABLE';break;}
  for(const l of got){if(l&&l.address&&l.address.toLowerCase()===f&&Array.isArray(l.topics)&&l.topics.length===2&&l.topics[0].toLowerCase()===TOPIC_GRADUATED_V2&&typeof l.data==='string'&&/^0x[0-9a-f]{192}$/i.test(l.data))out.push({token:addrOf(l.topics[1]),block:Number(BigInt(l.blockNumber)),version:'v2'});}
  to=from;
 }
 out.sort((a,b)=>b.block-a.block);
 return {graduations:out.slice(0,max),total:out.length,block:B,status,requests};
}
async function recentLaunches(rpcUrl,{fetcher,now},{windowBlocks=RECENT_WINDOW_BLOCKS,v2WindowBlocks=V2_WINDOW_BLOCKS,maxLaunches=300,maxWindows=4,enough=200,timed=20}={}){
 let requests=0;
 const head=(await batch(rpcUrl,[{method:'eth_chainId',params:[]},{method:'eth_blockNumber',params:[]}],{fetcher,now})); requests++;
 if(head[0]?.result===undefined||Number(BigInt(head[0].result))!==4663)throw http.fail('RADAR_PONS_WRONG_CHAIN');
 const B=Number(BigInt(head[1].result));
 const launches=[],perFactory={};let status='OK',smallest=windowBlocks,windowsUsed=0;
 for(const f of PONS.factories){
  const v2=PONS.versions[f]==='v2',top=v2?TOPIC_LAUNCHED_V2:TOPIC_LAUNCHED;
  let window=v2?v2WindowBlocks:windowBlocks,to=B;const pf=perFactory[f]={version:PONS.versions[f],logs:0,windows:0,coveredBlocks:0};
  for(let w=0;w<(v2?maxWindows:1)&&to>0&&pf.logs<enough;w++){
   let got=null,from=0;
   for(let attempt=0;attempt<5&&got===null;attempt++){
    from=Math.max(0,to-window);
    let res;
    try{res=await batch(rpcUrl,[{method:'eth_getLogs',params:[{address:f,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16),topics:[top]}]}],{fetcher,now});requests++;}
    catch(e){
     if(e.code==='RADAR_PROVIDER_RESPONSE_TOO_LARGE'){window=Math.floor(window/2);status='WINDOW_REDUCED';continue;}
     throw e;
    }
    const r=res[0];
    if(r&&Array.isArray(r.result))got=r.result;
    else if(r&&r.error&&/span|limit|range|exceed|too many/i.test(String(r.error.message))){window=Math.floor(window/2);status='WINDOW_REDUCED';}
    else throw http.fail('RADAR_PONS_LOGS_UNAVAILABLE');
   }
   if(got===null){status='LOGS_UNAVAILABLE';break;}
   pf.windows++;windowsUsed++;pf.coveredBlocks+=to-from;smallest=Math.min(smallest,window);
   for(const l of got){const x=parseLog(l,f);if(x){launches.push(x);pf.logs++;}}
   to=from;
  }
 }
 launches.sort((a,b)=>a.block-b.block);
 const newest=launches.slice(-maxLaunches);
 await blockTimes(rpcUrl,newest.slice(-timed),{fetcher,now},c=>{requests+=c;});
 return {launches:newest,total:launches.length,block:B,windowBlocks:smallest,windowsUsed,perFactory,status,requests};
}
// Bonding-curve state for V2 tokens still in phase 0 (no DEX pool exists yet). Raw reserves are read on-chain; USD is NEVER derived here.
// getReserves() layout: first two words are read as (quote reserve, token reserve) of the curve; progress = realQuoteReserve / graduationThreshold.
const CSEL={getReserves:sel('getReserves()'),realQuoteReserve:sel('realQuoteReserve()'),graduationThreshold:sel('graduationThreshold()'),isNativeQuote:sel('isNativeQuote()')};
async function curveStates(rpcUrl,items,{fetcher,now}){
 const out=new Map();
 for(let i=0;i<items.length;i+=10){
  const part=items.slice(i,i+10),calls=[];
  for(const it of part)for(const k of ['realQuoteReserve','graduationThreshold','isNativeQuote','getReserves'])calls.push({method:'eth_call',params:[{to:it.curve,data:CSEL[k]},'latest']});
  let res;try{res=await batch(rpcUrl,calls,{fetcher,now});}catch(e){if(e.code==='RADAR_PROVIDER_RATE_LIMITED')throw e;continue;}
  part.forEach((it,j)=>{
   const [rq,gt,nq,rs]=[0,1,2,3].map(k=>res[j*4+k]),ok=x=>x&&!x.error&&typeof x.result==='string'&&/^0x[0-9a-f]{64,}$/i.test(x.result);
   const big=x=>BigInt('0x'+word(x.result,0));
   const st={status:'ONCHAIN_READ',curve:it.curve,phase:'BONDING_CURVE'};
   if(ok(rq)&&ok(gt)){const a=big(rq),b=big(gt);st.realQuoteReserveRaw=a.toString();st.graduationThresholdRaw=b.toString();st.progressPct=b>0n?Math.min(100,Number(a*10000n/b)/100):null;}
   if(ok(nq))st.nativeQuote=big(nq)===1n;
   if(ok(rs)&&rs.result.length>=2+128){st.reservesRaw=[BigInt('0x'+word(rs.result,0)).toString(),BigInt('0x'+word(rs.result,1)).toString()];}
   st.priceUsd={status:'NOT_VERIFIED',reasonCode:'NO_VERIFIED_QUOTE_USD'};
   out.set(it.token,st);
  });
 }
 return out;
}
module.exports={SEL,TOPIC_LAUNCHED,TOPIC_LAUNCHED_V2,TOPIC_GRADUATED_V2,recentGraduations,PHASES,calldata,decodeLaunch,decodeLaunchV2,decodeGraduation,membership,membershipMany,recentLaunches,curveStates,blockTimes,graduatedV2};
