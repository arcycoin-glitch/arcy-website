'use strict';
// Issue #279 — Radar Intelligence Engine: adversarial regression suite (deterministic, no network).
const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../lib/radar-v2/intel/fetch'),R=require('../lib/radar-v2/intel/registry'),SEAL=require('../lib/radar-v2/intel/seal');
const OC=require('../lib/radar-v2/intel/onchain'),GH=require('../lib/radar-v2/intel/github'),GOV=require('../lib/radar-v2/intel/governance');
const EX=require('../lib/radar-v2/intel/explorer'),E=require('../lib/radar-v2/intel/engine'),P=require('../lib/radar-v2/pre-catalyst');
const DAY=86400000,NOW=Date.parse('2026-11-18T12:00:00Z');
const TOKEN='0x1111111111111111111111111111111111111111',USDC='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',POOL='0x2222222222222222222222222222222222222222';
const UNI_V2='0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',ROUTER='0x3333333333333333333333333333333333333333';
const SHA='a'.repeat(40),REPO='acme-labs/acme-protocol';
const pad=(x,n=64)=>String(x).replace(/^0x/,'').padStart(n,'0');
const w=v=>pad(BigInt(v).toString(16));
const aw=a=>'0x'+pad(a.slice(2));
const isoAgo=d=>new Date(NOW-d*DAY).toISOString();
// ── Fake EVM world: 1 block per second, V2 pool Sync every 60 blocks, token Transfer logs in the last 3h ──
function world({priceAt=()=>1,factory=UNI_V2,token0=TOKEN,token1=USDC,noLogs=false,buyers=20,whale=false,sellReverts=false,
 mint=false,proxy=false,liquidityTokens=1e6,codeSelectors=['a9059cbb','23b872dd','095ea7b3','70a08231','18160ddd','313ce567','dd62ed3e']}={}){
 const T0=Math.floor((NOW-60*DAY)/1000),head=Math.floor(NOW/1000)-T0,calls={n:0,byMethod:{}};
 const block=n=>({number:'0x'+n.toString(16),timestamp:'0x'+(T0+n).toString(16),hash:'0x'+pad(n.toString(16))});
 const transfers=[];
 if(!noLogs){
  let tx=1;const b0=head-3*3600+100;
  for(let i=0;i<buyers;i++){
   const buyer='0x'+(whale&&i>0?'9':(0xa0+i).toString(16)).padEnd(40,whale&&i>0?'9':'0').slice(0,40);
   const amt=whale&&i===0?10n**24n:10n**20n;
   const h='0x'+pad((tx++).toString(16));
   transfers.push({from:POOL,to:ROUTER,amt,block:b0+i*10,idx:1,tx:h},{from:ROUTER,to:buyer,amt,block:b0+i*10,idx:2,tx:h});
   if(whale&&i>0){const s='0x'+pad((tx++).toString(16));transfers.push({from:buyer,to:POOL,amt,block:b0+i*10+5,idx:1,tx:s});}
  }
 }
 const lastBuyer=transfers.filter(t=>t.from===ROUTER).at(-1)?.to;
 const code='0x6080'+codeSelectors.concat(mint?['40c10f19']:[]).map(s=>'63'+s).join('')+'00';
 const rpc=async(method,params)=>{
  calls.n++;calls.byMethod[method]=(calls.byMethod[method]||0)+1;
  if(method==='eth_getBlockByNumber'){const n=params[0]==='latest'?head:Number(BigInt(params[0]));return block(Math.min(n,head));}
  if(method==='eth_getCode')return params[0]===TOKEN?code:'0x6001';
  if(method==='eth_getStorageAt')return proxy&&params[1].startsWith('0x3608')?aw('0x4444444444444444444444444444444444444444'):'0x'+'0'.repeat(64);
  if(method==='eth_call'){
   const {to,data,from}=params[0],s=data.slice(0,10);
   if(to===POOL&&s===OC.SELECTORS.factory)return aw(factory);
   if(to===POOL&&s===OC.SELECTORS.token0)return aw(token0);
   if(to===POOL&&s===OC.SELECTORS.token1)return aw(token1);
   if(s===OC.SELECTORS.decimals)return '0x'+w(to===USDC?6:18);
   if(to===TOKEN&&s===OC.SELECTORS.balanceOf)return '0x'+w(10n**20n);
   if(to===TOKEN&&s===OC.SELECTORS.transfer){if(sellReverts)throw Object.assign(Error('execution reverted'),{code:'CALL_REVERTED'});return '0x'+w(1);}
   if(to===TOKEN&&s===OC.SELECTORS.owner)return aw('0x5555555555555555555555555555555555555555');
   throw Object.assign(Error('execution reverted'),{code:'CALL_REVERTED'});
  }
  if(method==='eth_getLogs'){
   const f=params[0],from=Number(BigInt(f.fromBlock)),to=Number(BigInt(f.toBlock));
   if(f.address===POOL&&f.topics[0]===OC.TOPICS.SYNC){
    if(noLogs)return [];
    const out=[];for(let n=Math.ceil(from/60)*60;n<=to;n+=60){const p=priceAt(T0+n);
     const r0=BigInt(Math.round(liquidityTokens))*10n**18n,r1=BigInt(Math.round(liquidityTokens*p*1e6));
     out.push({address:POOL,blockNumber:'0x'+n.toString(16),logIndex:'0x0',topics:[OC.TOPICS.SYNC],data:'0x'+w(token0===TOKEN?r0:r1)+w(token0===TOKEN?r1:r0)});}
    return out;
   }
   if(f.address===TOKEN&&f.topics[0]===OC.TOPICS.TRANSFER)
    return transfers.filter(t=>t.block>=from&&t.block<=to).map(t=>({address:TOKEN,blockNumber:'0x'+t.block.toString(16),logIndex:'0x'+t.idx.toString(16),transactionHash:t.tx,
     topics:[OC.TOPICS.TRANSFER,aw(t.from),aw(t.to)],data:'0x'+w(t.amt)}));
   return [];
  }
  throw Error('unexpected '+method);
 };
 return {rpc,calls,lastBuyer,T0};
}
// ── Fake HTTP (GitHub / Snapshot / Blockscout) ──
function http(routes,log=[]){
 return async(url,opt)=>{
  log.push({url,opt});
  assert.equal(opt.redirect,'error');
  const key=Object.keys(routes).find(k=>url.startsWith(k));
  if(!key)return {status:404,ok:false,headers:new Map(),text:async()=>'{}'};
  const r=typeof routes[key]==='function'?routes[key](url,opt):routes[key];
  const status=r.status||200;
  return {status,ok:status>=200&&status<300,headers:new Map(Object.entries(r.headers||{})),text:async()=>JSON.stringify(r.body??{})};
 };
}
const b64=s=>Buffer.from(s).toString('base64');
function githubRoutes({address=TOKEN,archived=false,commits=30,releases=2,milestoneDue=20,milestoneIssues=3,fileHasAddress=true}={}){
 const api='https://api.github.com/repos/'+REPO;
 return {
  [api+'/contents/']:{body:{type:'file',encoding:'base64',size:200,content:b64('{"token":"'+(fileHasAddress?address:'0x'+'9'.repeat(40))+'"}')}},
  [api+'/releases']:{body:Array.from({length:releases},(_,i)=>({tag_name:'v1.'+i,name:'v1.'+i,published_at:isoAgo(5+i*20),draft:false,prerelease:false,html_url:'https://github.com/'+REPO+'/releases/tag/v1.'+i}))},
  [api+'/commits']:{body:Array.from({length:commits},(_,i)=>({author:{login:'dev'+(i%3)},commit:{committer:{date:isoAgo(i)}}}))},
  [api+'/milestones']:{body:milestoneDue===null?[]:[{title:'Mainnet v2 launch',due_on:new Date(NOW+milestoneDue*DAY).toISOString(),html_url:'https://github.com/'+REPO+'/milestone/4',open_issues:milestoneIssues,closed_issues:milestoneIssues?5:0}]},
  [api]:{body:{full_name:REPO,owner:{login:'acme-labs',type:'Organization'},fork:false,archived,disabled:false,pushed_at:isoAgo(1),homepage:'https://acme.example',html_url:'https://github.com/'+REPO,default_branch:'main'}},
  'https://api.github.com/orgs/acme-labs':{body:{is_verified:true,blog:'https://acme.example'}},
  'https://eth.blockscout.com/api/v2/smart-contracts/':{body:{is_verified:true,name:'Acme',abi:[{type:'function',name:'transfer',stateMutability:'nonpayable'},{type:'function',name:'approve',stateMutability:'nonpayable'},
   {type:'function',name:'transferFrom',stateMutability:'nonpayable'},{type:'function',name:'balanceOf',stateMutability:'view'}]}},
  ['https://eth.blockscout.com/api/v2/tokens/'+TOKEN+'/holders']:{body:{items:Array.from({length:10},(_,i)=>({address:{hash:'0x'+(i+1).toString(16).padStart(40,'b'),is_contract:false},value:String(5e22)}))}},
  ['https://eth.blockscout.com/api/v2/tokens/'+TOKEN]:{body:{total_supply:String(1e24),holders_count:'1200'}}
 };
}
function registryDoc({address=TOKEN,chainId=1,network='ethereum',expiresIn=60,domains=['acme.example'],ref=SHA}={}){
 return {schema:'arcy-radar-project-registry/1',version:'test.1',projects:[{id:'acme',name:'Acme Protocol',tokens:[{network,chainId,address}],
  official:{domains,github:{owner:'acme-labs',repos:[REPO]}},
  proofs:[{kind:'GITHUB_FILE',repo:REPO,path:'deployments/1.json',ref,addresses:[address],retrievedAt:isoAgo(2)}],
  review:{reviewer:'arcy-owner',reviewedAt:isoAgo(2),expiresAt:new Date(NOW+expiresIn*DAY).toISOString()}}]};
}
function row(over={}){
 return {rank:1,network:'ethereum',chainId:1,address:TOKEN,symbol:'ACME',name:'Acme Protocol',pool:POOL,dex:'Uniswap V2',quote:{address:USDC,symbol:'USDC'},
  priceUsd:1,volume24hUsd:400000,liquidityUsd:2000000,change24hPct:2,poolCreatedAt:isoAgo(45),buys24h:300,sells24h:280,
  fields:{change24hPct:{status:'CROSS_VERIFIED',value:2,sources:[{provider:'GeckoTerminal',value:2},{provider:'DEX Screener',value:2.1}]}},
  discovery:{version:'arcy-discovery-2',score:60,poolsSeen:1},...over};
}
const section=(network,tokens,over={})=>({ok:true,network,chainId:{arc:5042,ethereum:1,robinhood:4663,pons:4663}[network],asOf:new Date(NOW-600000).toISOString(),freshness:'FRESH',tokens,...over});
const goodExit=async()=>({ok:true,executableUsd:25000,verifiedSizes:3,model:'TEST_REVIEWED_MODEL',block:1});
async function runOne({w=world(),routes=githubRoutes(),reg=registryDoc(),rows=[row()],exitAnalyzer=goodExit,limits={}}={}){
 F._reset();E._clearCache();OC._resetMemo();
 return E.run({sections:{ethereum:section('ethereum',rows)},now:NOW,env:{},fetcher:http(routes),rpc:{ethereum:w.rpc},registryDoc:reg,exitAnalyzer,limits:{concurrency:1,...limits}});
}
const only=r=>r.networks.ethereum.all[0];

test('end-to-end: complete independent evidence => ELIGIBLE with a short source-backed Info reason',async()=>{
 const r=await runOne();const x=only(r);
 assert.equal(x.eligibility,'ELIGIBLE',JSON.stringify(x.reasons)+JSON.stringify(x.notes));
 assert.equal(r.networks.ethereum.selected.length,1);
 assert.equal(x.evidenceConfidence.score,1);
 assert.match(x.info,/^Why selected: Official address published by github\.com\/acme-labs\/acme-protocol/);
 assert.match(x.info,/no verified 8x in 7d\/30d/);assert.ok(x.info.length<=300);
 assert.equal(x.runup.history,'RUNUP_CLEARED');
 assert.equal(x.scoreVersion,'arcy-discovery-2');assert.equal(x.discoveryScore,60);
 assert.ok(x.sources.some(u=>u.includes('/blob/'+SHA+'/')));
 assert.equal(r.mode,'SHADOW_ONLY');assert.equal(r.opportunityVersion,'arcy-opportunity-1');
});
test('anti-pump: sustained 9x then -90% is EXCLUDE_ALREADY_RAN_8X (a drawdown is not an opportunity)',async()=>{
 const w=world({priceAt:s=>{const d=(NOW/1000-s)/86400;return d>20?1:d>10?9:0.9;}});
 const x=only(await runOne({w,rows:[row({priceUsd:0.9})]}));
 assert.equal(x.eligibility,'EXCLUDE');assert.ok(x.reasons.includes('EXCLUDE_ALREADY_RAN_8X'));assert.ok(x.risk.includes('EXCLUDE_ALREADY_RAN_8X'));
});
test('anti-pump: verified 20x inside 7 days is excluded even with perfect fundamentals',async()=>{
 const w=world({liquidityTokens:1e8,priceAt:s=>{const d=(NOW/1000-s)/86400;return d>5?0.05:1;}});
 assert.ok(only(await runOne({w})).reasons.includes('EXCLUDE_ALREADY_RAN_8X'));
});
test('anti-pump: a single manipulated candle (20x wick) does not create a peak or a baseline',async()=>{
 const w=world({priceAt:s=>{const d=Math.round((NOW/1000-s)/86400);return d===10?20:1;}});
 const x=only(await runOne({w}));
 assert.equal(x.eligibility,'ELIGIBLE',JSON.stringify(x.reasons));
});
test('anti-pump: 5x-8x sustained run is REVIEW, never ELIGIBLE',async()=>{
 const w=world({priceAt:s=>{const d=(NOW/1000-s)/86400;return d>15?1:6;}});
 const x=only(await runOne({w,rows:[row({priceUsd:6})]}));
 assert.equal(x.eligibility,'REVIEW');assert.ok(x.reasons.includes('RUNUP_NOT_VERIFIED'));
});
test('anti-pump: verified 24h >=700% from two providers is excluded by the preserved #277 gate',async()=>{
 const x=only(await runOne({rows:[row({change24hPct:750,fields:{change24hPct:{status:'CROSS_VERIFIED',value:750,sources:[{provider:'GeckoTerminal',value:750},{provider:'DEX Screener',value:748}]}}})]}));
 assert.ok(x.reasons.includes('EXCLUDE_VERIFIED_24H_8X'));assert.equal(x.eligibility,'EXCLUDE');
});
test('missing history never means clean: no pool events => RUNUP_NOT_VERIFIED and REVIEW',async()=>{
 const x=only(await runOne({w:world({noLogs:true})}));
 assert.equal(x.runup.history,'RUNUP_NOT_VERIFIED');assert.equal(x.eligibility,'REVIEW');
});
test('dust liquidity candles are rejected; the history gate cannot clear on dust',async()=>{
 const x=only(await runOne({w:world({liquidityTokens:10})}));
 assert.equal(x.runup.history,'RUNUP_NOT_VERIFIED');
});
test('pool identity: unreviewed factory, mismatched pair (migration/wrong pool) and non-USD quote stay NOT_VERIFIED',async()=>{
 assert.ok(only(await runOne({w:world({factory:'0x'+'7'.repeat(40)})})).notes.includes('HISTORY_POOL_FACTORY_NOT_REVIEWED'));
 assert.ok(only(await runOne({w:world({token1:'0x'+'8'.repeat(40)})})).notes.includes('HISTORY_POOL_TOKENS_MISMATCH'));
 const x=only(await runOne({rows:[row({quote:{address:'0x'+'6'.repeat(40),symbol:'MEME'}})]}));
 assert.ok(x.notes.includes('HISTORY_QUOTE_NOT_USD_STABLE_OR_ETH'));assert.equal(x.eligibility,'REVIEW');
});
test('inaccurate provider price (>25% from on-chain) is a source contradiction => REVIEW',async()=>{
 const x=only(await runOne({rows:[row({priceUsd:2})]}));
 assert.ok(x.notes.includes('PRICE_SOURCE_DISAGREEMENT'));assert.ok(x.reasons.includes('SOURCE_CONTRADICTION'));assert.notEqual(x.eligibility,'ELIGIBLE');
});
test('one-whale wash activity is not organic demand',async()=>{
 const x=only(await runOne({w:world({whale:true})}));
 assert.ok(x.reasons.includes('ORGANIC_BUYER_BREADTH_NOT_VERIFIED'));assert.notEqual(x.evidenceSummary.demand.cluster,'REVIEWED_NO_CONCENTRATION');
});
test('router hops are followed to the final buyer (router is not counted as a buyer)',async()=>{
 const w=world({buyers:20});
 const d=await OC.demand({rpc:w.rpc,network:'ethereum',candidate:row(),now:NOW,budget:{max:100,used:0}});
 assert.equal(d.distinctBuyers,20);assert.equal(d.window.complete,true);assert.ok(d.topBuyerShare<=0.06);
});
test('critical risk vetoes regardless of score: sell blocked, unlimited mint, blacklist privilege',async()=>{
 assert.ok(only(await runOne({w:world({sellReverts:true}),rows:[row({discovery:{version:'arcy-discovery-2',score:99,poolsSeen:1}})]})).reasons.includes('SELL_DISABLED'));
 const mintRoutes=githubRoutes();mintRoutes['https://eth.blockscout.com/api/v2/smart-contracts/']={body:{is_verified:true,abi:[{type:'function',name:'mint',stateMutability:'nonpayable'},{type:'function',name:'transfer',stateMutability:'nonpayable'}]}};
 assert.ok(only(await runOne({w:world({mint:true,codeSelectors:['8da5cb5b','a9059cbb']}),routes:mintRoutes})).reasons.includes('UNLIMITED_MINT'));
 const bl=githubRoutes();bl['https://eth.blockscout.com/api/v2/smart-contracts/']={body:{is_verified:true,abi:[{type:'function',name:'setBlacklist',stateMutability:'nonpayable'},{type:'function',name:'transfer',stateMutability:'nonpayable'}]}};
 assert.ok(only(await runOne({w:world({codeSelectors:['8da5cb5b','a9059cbb']}),routes:bl})).reasons.includes('DANGEROUS_ADMIN_PRIVILEGE'));
});
test('upgradeable proxy is never treated as bounded mint / reviewed admin',async()=>{
 const x=only(await runOne({w:world({proxy:true})}));
 assert.ok(x.reasons.includes('MINT_NOT_VERIFIED'));assert.ok(x.reasons.includes('ADMIN_NOT_VERIFIED'));
});
test('low exit: verified quotes that all cost >5% => LOW_EXIT_LIQUIDITY exclusion; analyzer failure => NOT_VERIFIED',async()=>{
 assert.ok(only(await runOne({exitAnalyzer:async()=>({ok:true,executableUsd:0,verifiedSizes:3})})).reasons.includes('LOW_EXIT_LIQUIDITY'));
 assert.ok(only(await runOne({exitAnalyzer:async()=>{throw Object.assign(Error('x'),{code:'RPC_TIMEOUT'});}})).reasons.includes('EXIT_LIQUIDITY_NOT_VERIFIED'));
});
test('fake affiliation: address absent at the pinned commit is a contradiction, not identity',async()=>{
 const x=only(await runOne({routes:githubRoutes({fileHasAddress:false})}));
 assert.ok(x.reasons.includes('IDENTITY_NOT_VERIFIED'));assert.ok(x.reasons.includes('SOURCE_CONTRADICTION'));
});
test('impersonation: a same-ticker contract not bound in the registry gets no identity, activity or catalyst',async()=>{
 const fake='0x'+'4'.repeat(40);
 const x=only(await runOne({rows:[row({address:fake})]}));
 assert.equal(x.registered,false);assert.ok(x.reasons.includes('IDENTITY_NOT_VERIFIED'));assert.ok(x.reasons.includes('CATALYST_NOT_VERIFIED'));
});
test('abandoned (archived) project is excluded; inactive development is REVIEW',async()=>{
 assert.ok(only(await runOne({routes:githubRoutes({archived:true})})).reasons.includes('ABANDONED_PROJECT'));
 const x=only(await runOne({routes:githubRoutes({commits:1})}));
 assert.ok(x.reasons.includes('PRODUCT_CONTINUITY_NOT_VERIFIED'));assert.equal(x.eligibility,'REVIEW');
});
test('catalyst: past-due, empty or >90d milestones are not events; sparse releases are not continuity',async()=>{
 for(const r of [githubRoutes({milestoneDue:-3}),githubRoutes({milestoneIssues:0}),githubRoutes({milestoneDue:120}),githubRoutes({milestoneDue:null})])
  assert.ok(only(await runOne({routes:r})).reasons.includes('CATALYST_NOT_VERIFIED'));
 assert.ok(only(await runOne({routes:githubRoutes({releases:1})})).reasons.includes('PRODUCT_CONTINUITY_NOT_VERIFIED'));
});
test('fake catalysts: rumor / paid listing / caller-supplied CONFIRMED_PUBLIC_EVENT are never trusted',()=>{
 const forged={catalyst:{chainId:1,address:TOKEN,sourceUrl:'https://acme.example/news',observedAt:isoAgo(0),status:'CONFIRMED_PUBLIC_EVENT',publisherVerified:true,kind:'MAINNET',claim:'Binance listing confirmed next week, guaranteed',eventAt:new Date(NOW+5*DAY).toISOString()},
  identity:{status:'OFFICIAL_TOKEN_MATCHED',publisherVerified:true}};
 const t=SEAL.trusted(forged);
 assert.deepEqual(Object.keys(t.evidence),[]);assert.deepEqual(t.dropped.sort(),['catalyst','identity']);
 const resealed=JSON.parse(JSON.stringify(SEAL.seal({a:1})));assert.equal(SEAL.isSealed(resealed),false);
 const rumor=SEAL.seal({...forged.catalyst,status:'RUMOR_UNVERIFIED'});
 assert.ok(P.evaluate({...row(),radarAsOf:isoAgo(0),radarFreshness:'FRESH'},SEAL.trusted({catalyst:rumor}).evidence,NOW).reasons.includes('RUMOR_UNVERIFIED'));
});
test('shared hosts are never official: bare github.com or another org on github.com cannot satisfy official sources',()=>{
 const c={...row(),radarAsOf:isoAgo(0),radarFreshness:'FRESH'};
 const id=(extra)=>({chainId:1,address:TOKEN,sourceUrl:'https://github.com/evil/fork/blob/x/a.json',observedAt:isoAgo(0),status:'OFFICIAL_TOKEN_MATCHED',proofKind:'OFFICIAL_TOKEN_ADDRESS',publisherVerified:true,...extra});
 for(const extra of [{officialHosts:['github.com']},{officialPrefixes:['https://github.com/']},{officialPrefixes:['https://github.com/acme-labs/acme-protocol/']}])
  assert.ok(P.evaluate(c,{identity:id(extra)},NOW).reasons.includes('IDENTITY_NOT_VERIFIED'));
 assert.ok(!P.evaluate(c,{identity:id({sourceUrl:'https://github.com/acme-labs/acme-protocol/blob/x/a.json',officialPrefixes:['https://github.com/acme-labs/acme-protocol/']})},NOW).reasons.includes('IDENTITY_NOT_VERIFIED'));
});
test('registry validation: shared domain, expired review, wrong chain, missing proof, unpinned ref and duplicates are rejected individually',()=>{
 assert.equal(R.load(registryDoc(),NOW).projects.length,1);
 const bad=[registryDoc({domains:['github.com']}),registryDoc({expiresIn:-1}),registryDoc({chainId:5042}),registryDoc({ref:'main'})];
 for(const d of bad){const l=R.load(d,NOW);assert.equal(l.projects.length,0,JSON.stringify(l.rejected));}
 const noProof=registryDoc();noProof.projects[0].proofs=[];assert.ok(R.load(noProof,NOW).rejected[0].errors.includes('PROOFS_REQUIRED'));
 const dup=registryDoc();dup.projects.push({...structuredClone(dup.projects[0]),id:'acme-copy'});
 const l=R.load(dup,NOW);assert.equal(l.projects.length,1);assert.ok(l.rejected[0].errors.includes('DUPLICATE_TOKEN_BINDING'));
 assert.equal(R.load({schema:'x',projects:[]},NOW).rejected[0].errors[0],'REGISTRY_SCHEMA_INVALID');
 const longReview=registryDoc();longReview.projects[0].review.expiresAt=new Date(NOW+400*DAY).toISOString();assert.equal(R.load(longReview,NOW).projects.length,0);
});
test('the shipped registry file is valid, versioned and honest (no unreviewed bindings)',()=>{
 const doc=require('../lib/radar-v2/intel/project-registry.json');const l=R.load(doc,Date.now());
 assert.equal(l.schema,'arcy-radar-project-registry/1');assert.equal(l.rejected.length,0);
 for(const p of l.projects)assert.ok(p.review.reviewer&&p.proofs.length);
});
test('zero eligible is not padded; at most five per network even when more qualify',async()=>{
 const none=await runOne({reg:{schema:'arcy-radar-project-registry/1',version:'empty',projects:[]}});
 assert.equal(none.networks.ethereum.selected.length,0);assert.equal(none.networks.ethereum.counts.review,1);
 assert.ok(none.networks.ethereum.researchQueue[0].nextAction.action.includes('registry'));
 // seven fully evidenced candidates (same world, distinct exact contracts bound in the registry)
 const addrs=Array.from({length:7},(_,i)=>TOKEN);
 const r=E.discover({ethereum:section('ethereum',addrs.map(a=>row({address:a})))});
 assert.equal(r.sections.ethereum.candidates.length,1);assert.equal(r.sections.ethereum.duplicates,6);
});
test('max five selection cap',async()=>{
 const results=Array.from({length:8},(_,i)=>({eligibility:'ELIGIBLE',discoveryScore:50+i,key:'1:'+i}));
 const picked=results.filter(r=>r.eligibility==='ELIGIBLE').sort((a,b)=>b.discoveryScore-a.discoveryScore).slice(0,5);
 assert.equal(picked.length,5);assert.equal(picked[0].discoveryScore,57);
 const shortlist=P.shortlist([],{},NOW,'ethereum');assert.equal(shortlist.eligible.length,0);
});
test('Pons/Robinhood: factory-verified Pons launches are routed out of Robinhood; no exact-contract duplicate across tabs',()=>{
 const pons='0x39dbed3a2bd333467115de45665cc57f813c4571';
 const launch={status:'ONCHAIN_VERIFIED',factory:'0x0c37a24f5d23a486fa692d1500881d698b1f77a4',block:'0x10'};
 const d=E.discover({robinhood:section('robinhood',[row({network:'robinhood',chainId:4663,address:pons}),row({network:'robinhood',chainId:4663,address:'0x'+'5'.repeat(40)})]),
  pons:section('pons',[row({network:'pons',chainId:4663,address:pons,launch})])});
 assert.deepEqual(d.sections.robinhood.candidates.map(c=>c.address),['0x'+'5'.repeat(40)]);
 assert.equal(d.sections.robinhood.ponsRouted,1);assert.equal(d.sections.pons.candidates[0].address,pons);
 // an unverified Pons claim (no factory proof) does not remove the token from Robinhood
 const d2=E.discover({robinhood:section('robinhood',[row({network:'robinhood',chainId:4663,address:pons})]),pons:section('pons',[row({network:'pons',chainId:4663,address:pons,launch:{status:'NOT_VERIFIED'}})])});
 assert.equal(d2.sections.robinhood.candidates.length,1);
 // Pons evaluation still requires factory proof
 const c={...row({network:'pons',chainId:4663}),radarAsOf:isoAgo(0),radarFreshness:'FRESH'};
 assert.ok(P.evaluate(c,{},NOW).reasons.includes('PONS_FACTORY_NOT_VERIFIED'));
});
test('stale / invalid / wrong-chain section snapshots are labelled and never promoted',async()=>{
 const d=E.discover({arc:section('arc',[row()],{chainId:1}),ethereum:section('ethereum',[row()],{freshness:'STALE',asOf:isoAgo(2)})});
 assert.equal(d.sections.arc.status,'INVALID_SNAPSHOT');assert.equal(d.sections.ethereum.status,'STALE_SOURCE');
 assert.equal(d.sections.robinhood.status,'SOURCE_UNAVAILABLE');
 const x=only(await runOne({rows:[row()]}));assert.ok(x);
 const wrong=E.discover({ethereum:section('ethereum',[row({chainId:4663})])});assert.equal(wrong.sections.ethereum.invalid,1);
});
test('source outages: GitHub 503 / RPC down keep NOT_VERIFIED states and report them; nothing throws',async()=>{
 const down=githubRoutes();for(const k of Object.keys(down))if(k.startsWith('https://api.github.com'))down[k]={status:503,body:{}};
 const x=only(await runOne({routes:down}));
 assert.equal(x.eligibility,'REVIEW');assert.ok(x.reasons.includes('IDENTITY_NOT_VERIFIED'));assert.ok(x.notes.some(n=>/IDENTITY_INTEL_/.test(n)));
 const dead={rpc:async()=>{throw Object.assign(Error('down'),{code:'RPC_UNREACHABLE'});}};
 const y=only(await runOne({w:dead}));
 assert.equal(y.eligibility,'REVIEW');assert.ok(y.notes.some(n=>/HISTORY_|POOL_IDENTITY_/.test(n)));
});
test('budgets: per-network RPC budget is enforced and reported; on-chain work is skipped for low-priority unregistered rows',async()=>{
 const w=world();
 const r=await runOne({w,limits:{rpcPerNetwork:10}});
 assert.ok(r.cost.rpc.ethereum<=10);assert.ok(only(r).notes.some(n=>/BUDGET_EXHAUSTED/.test(n)));
 const many=Array.from({length:5},(_,i)=>row({address:'0x'+String(i+1).repeat(40),discovery:{version:'arcy-discovery-2',score:40+i,poolsSeen:1}}));
 const r2=await runOne({rows:many,reg:{schema:'arcy-radar-project-registry/1',version:'e',projects:[]},limits:{unregisteredOnchain:2}});
 assert.equal(r2.networks.ethereum.counts.onchainInspected,2);
 assert.equal(r2.networks.ethereum.all.filter(x=>x.notes.includes('ONCHAIN_SKIPPED_BY_BUDGET_POLICY')).length,3);
});
test('warm cache: a second run inside TTL spends no new HTTP or history RPC calls',async()=>{
 const w=world();F._reset();E._clearCache();OC._resetMemo();
 const opts={sections:{ethereum:section('ethereum',[row()])},now:NOW,env:{},fetcher:http(githubRoutes()),rpc:{ethereum:w.rpc},registryDoc:registryDoc(),exitAnalyzer:goodExit,limits:{concurrency:1}};
 const a=await E.run(opts);const before=w.calls.n;const b=await E.run(opts);
 assert.ok(b.cost.cacheHits>=5);assert.equal(b.cost.httpUsed,0);assert.ok(w.calls.n-before<=6,'only pool identity + decimals re-read: '+(w.calls.n-before));
 assert.equal(a.networks.ethereum.all[0].decisionHash,b.networks.ethereum.all[0].decisionHash);
});
test('fetch: allowlist, scheme, credentials, port and redirects are enforced (SSRF)',async()=>{
 F._reset();
 for(const u of ['http://api.github.com/x','https://user:pw@api.github.com/x','https://api.github.com:8443/x','https://evil.example/x','https://169.254.169.254/latest','https://localhost/x','https://api.github.com.evil.example/x'])
  await assert.rejects(F.json(u,{fetcher:async()=>{throw Error('must not be called');}}),e=>/INTEL_(URL_UNSAFE|HOST_NOT_ALLOWED|URL_INVALID)/.test(e.code));
 await assert.rejects(F.json('https://api.github.com/r',{fetcher:async(u,o)=>{assert.equal(o.redirect,'error');throw new TypeError('redirect mode is set to error');}}),{code:'INTEL_UNREACHABLE'});
});
test('fetch: 429 retried once with backoff then cooldown; 503 trips the circuit breaker; oversize and invalid JSON rejected',async()=>{
 F._reset();let n=0;const sleeps=[];
 const ok=await F.json('https://api.github.com/a',{sleep:async ms=>sleeps.push(ms),fetcher:async()=>(++n===1?{status:429,ok:false,headers:new Map([['retry-after','1']]),text:async()=>''}:{status:200,ok:true,headers:new Map(),text:async()=>'{"a":1}'})});
 assert.deepEqual(ok,{a:1});assert.deepEqual(sleeps,[1000]);
 F._reset();
 await assert.rejects(F.json('https://api.github.com/b',{sleep:async()=>{},fetcher:async()=>({status:429,ok:false,headers:new Map(),text:async()=>''})}),{code:'INTEL_RATE_LIMITED'});
 await assert.rejects(F.json('https://api.github.com/c',{fetcher:async()=>{throw Error('no call during cooldown');}}),{code:'INTEL_PROVIDER_COOLDOWN'});
 F._reset();
 for(let i=0;i<F.BREAKER_THRESHOLD;i++)await assert.rejects(F.json('https://hub.snapshot.org/graphql?'+i,{fetcher:async()=>({status:500,ok:false,headers:new Map(),text:async()=>''})}));
 await assert.rejects(F.json('https://hub.snapshot.org/graphql',{fetcher:async()=>{throw Error('breaker must block');}}),{code:'INTEL_CIRCUIT_OPEN'});
 F._reset();
 await assert.rejects(F.json('https://api.github.com/d',{fetcher:async()=>({status:200,ok:true,headers:new Map(),text:async()=>'x'.repeat(F.MAX_BYTES+1)})}),{code:'INTEL_RESPONSE_TOO_LARGE'});
 await assert.rejects(F.json('https://api.github.com/e',{fetcher:async()=>({status:200,ok:true,headers:new Map(),text:async()=>'<html>'})}),{code:'INTEL_INVALID_JSON'});
 await assert.rejects(F.json('https://api.github.com/f',{fetcher:async()=>{const e=new Error('t');e.name='TimeoutError';throw e;}}),{code:'INTEL_TIMEOUT'});
});
test('fetch: ETag revalidation, daily/run budgets, token only to api.github.com',async()=>{
 F._reset();const seen=[];
 const fetcher=async(u,o)=>{seen.push(o.headers);return o.headers['if-none-match']?{status:304,ok:false,headers:new Map(),text:async()=>''}:{status:200,ok:true,headers:new Map([['etag','"v1"']]),text:async()=>'{"v":1}'};};
 const env={GITHUB_TOKEN:'ghp_'+'x'.repeat(36)};
 assert.deepEqual(await F.json('https://api.github.com/etag',{fetcher,env}),{v:1});
 assert.deepEqual(await F.json('https://api.github.com/etag',{fetcher,env}),{v:1});
 assert.equal(seen[1]['if-none-match'],'"v1"');assert.ok(seen[0].authorization.startsWith('Bearer '));
 await F.json('https://eth.blockscout.com/api/v2/x',{fetcher,env});assert.equal(seen[2].authorization,undefined);
 const run={budget:{max:1,used:1}};
 await assert.rejects(F.json('https://api.github.com/z',{fetcher,run}),{code:'INTEL_RUN_BUDGET_EXHAUSTED'});
});
test('onchain identity: V4 pool requires the reviewed PositionManager PoolKey whose recomputed id matches',async()=>{
 const id='0x'+'ab'.repeat(32);
 const call=async(m,p)=>{if(m==='eth_call')return '0x'+'0'.repeat(64*5);throw Error('x');};
 const r=await OC.identify(call,'robinhood',id,TOKEN,'0x0bd7d308f8e1639fab988df18a8011f41eacad73');
 assert.equal(r.ok,false);
 const none=await OC.identify(call,'ethereum',id,TOKEN,USDC);assert.equal(none.reason,'POOL_MANAGER_NOT_REVIEWED');
});
test('bytecode scan reads PUSH4 selectors and opcodes without confusing push data',()=>{
 const s=OC.scanBytecode('0x6340c10f1900f4');assert.equal(s.mintSelector,true);assert.equal(s.delegatecall,true);
 const hidden=OC.scanBytecode('0x7f'+'f4'.repeat(32)+'00');assert.equal(hidden.delegatecall,false);
});
test('governance: only pending/active proposals in the registered space closing within 90 days count',async()=>{
 const items=[{id:'0x'+'1'.repeat(64),title:'Enable fee switch v2',startAt:isoAgo(1),endAt:new Date(NOW+3*DAY).toISOString(),state:'active',url:'https://snapshot.box/#/s:acme.eth/proposal/x'}];
 const e=GOV.classify(items,{now:NOW,chainId:1,address:TOKEN,space:'acme.eth'});assert.equal(e.kind,'GOVERNANCE_VOTE');
 assert.equal(GOV.classify([{...items[0],endAt:isoAgo(1)}],{now:NOW,chainId:1,address:TOKEN,space:'acme.eth'}),null);
 F._reset();
 const g=await GOV.proposals({space:'acme.eth',now:NOW,o:{fetcher:http({'https://hub.snapshot.org/graphql':{body:{data:{proposals:[{id:'0x'+'1'.repeat(64),title:'t',start:1,end:2,state:'closed',space:{id:'acme.eth'}},{id:'0x'+'2'.repeat(64),title:'other space',start:1,end:9e9,state:'active',space:{id:'evil.eth'}}]}}}})}});
 assert.equal(g.ok,true);assert.equal(g.items.length,0);
});
test('explorer ABI surface: standard ERC-20 only vs privileged functions',()=>{
 const s=EX.abiSurface([{type:'function',name:'transfer',stateMutability:'nonpayable'},{type:'function',name:'burn',stateMutability:'nonpayable'}]);
 assert.deepEqual(s.nonStandard,[]);assert.equal(s.hasMint,false);
 const d=EX.abiSurface([{type:'function',name:'setSellFee',stateMutability:'nonpayable'},{type:'function',name:'mint',stateMutability:'nonpayable'},{type:'function',name:'cap',stateMutability:'view'}]);
 assert.deepEqual(d.dangerous,['setSellFee']);assert.equal(d.hasMint,true);assert.equal(d.hasCap,true);
});
test('github content decoding and exact-address matching (no prefix/suffix collisions)',()=>{
 const re=GH.ADDRESS_IN_TEXT(TOKEN);
 assert.ok(re.test('{"a":"'+TOKEN+'"}'));assert.ok(re.test(TOKEN.toUpperCase().replace('0X','0x')));
 assert.ok(!re.test('0x'+'1'.repeat(41)));assert.ok(!re.test('ab'+TOKEN.slice(2)));
 assert.equal(GH.decodeContent({type:'dir'}),null);
});
test('decision log is reproducible and carries version provenance',async()=>{
 const a=await runOne(),b=await runOne();
 assert.equal(only(a).decisionHash,only(b).decisionHash);
 assert.equal(a.registry.version,'test.1');assert.match(a.registry.digest,/^[0-9a-f]{64}$/);
});
test('live-probe regression: production Pons launch.block is a decimal number and is accepted as factory proof',()=>{
 const launch={status:'ONCHAIN_VERIFIED',factory:'0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',block:116895900};
 const c={...row({network:'pons',chainId:4663,launch}),radarAsOf:isoAgo(0),radarFreshness:'FRESH'};
 assert.ok(!P.evaluate(c,{},NOW).reasons.includes('PONS_FACTORY_NOT_VERIFIED'));
 for(const block of [0,-5,'116895900',null,1.5])assert.ok(P.evaluate({...c,launch:{...launch,block}},{},NOW).reasons.includes('PONS_FACTORY_NOT_VERIFIED'));
});
test('live-probe regression: block-at-time converges from below on irregular block times (no overshoot failure)',async()=>{
 // blocks are 0.05s for the first half of history and 0.2s afterwards: a constant-rate guess overshoots
 const T0=1.7e9,mid=5e6,tsOf=n=>n<=mid?T0+n*0.05:T0+mid*0.05+(n-mid)*0.2,headN=mid+4e6,calls=[];
 const call=async(m,p)=>{calls.push(p[0]);const n=p[0]==='latest'?headN:Number(BigInt(p[0]));return {number:'0x'+n.toString(16),timestamp:'0x'+Math.floor(tsOf(n)).toString(16)};};
 const head=await OC.headOf(call,'robinhood');
 for(const target of [T0+100000,T0+mid*0.05-3600,Math.floor(tsOf(headN))-86400*3]){
  const b=await OC.blockAt(call,'robinhood',Math.floor(target),new Map(),head);
  assert.ok(b.timestamp<=target&&target-b.timestamp<=900,'target '+target+' got '+b.timestamp);
 }
});
test('live-probe regression: unreadable Transfer logs are NOT reported as zero verified buyers',async()=>{
 const w=world();
 const rpc=async(m,p)=>{if(m==='eth_getLogs')throw Object.assign(Error('response too large'),{code:'RPC_RESPONSE_TOO_LARGE'});return w.rpc(m,p);};
 const d=await OC.demand({rpc,network:'ethereum',candidate:row(),now:NOW,budget:{max:100,used:0}});
 assert.deepEqual(d,{ok:false,reason:'TRANSFER_LOGS_UNREADABLE'});
});
