'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const audit=require('../scripts/coverage-audit.cjs');
const found=(status,value='x')=>({dataState:'DATA_FOUND',status,value,source:'s',evidence:[{}]});
const missing=(reasonCode,dataState='NOT_VERIFIED')=>({dataState,status:'NOT_VERIFIED',value:null,reasonCode});
const card=(fields)=>Object.fromEntries(Object.entries(fields));
const fullCard=(cardId,field)=>Object.fromEntries(({
 supply:['totalSupply','circulatingSupply','burnAddressBalance','nextUnlock'],
 holders:['holderCount','largestWalletPct','top10Pct','top20Pct'],
 mechanics:['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture']})[cardId].map(k=>[k,field]));

test('only allow-listed statuses count as VERIFIED; source-reported and unknown statuses never do',()=>{
 for(const s of ['ON_CHAIN','ON_CHAIN_DERIVED','ONCHAIN_VERIFIED','ONCHAIN_RECONCILED','RECONCILED_SNAPSHOT','VERIFIED_SOURCE','VERIFIED_SOURCE_AND_STATE','HISTORICAL_ONCHAIN_VERIFIED','GETTER_REPORTED','NOT_DETECTED'])
  assert.equal(audit.tierOf(found(s)).tier,'VERIFIED',s);
 for(const s of ['SOURCE_REPORTED','SOURCE_REPORTED_RPC_RECONCILED','PROJECT_REPORTED','OFFICIAL_DOCUMENTATION','MARKET_API_VERIFIED'])
  assert.equal(audit.tierOf(found(s)).tier,'SOURCE_REPORTED',s);
 assert.deepEqual(audit.tierOf(found('SOMETHING_NEW')),{tier:'UNCLASSIFIED',subtier:'SOMETHING_NEW'});
 assert.equal(audit.tierOf(found('ON_CHAIN',null)).tier,'UNCLASSIFIED','DATA_FOUND without a value is never coverage');
 assert.equal(audit.tierOf(missing('X')).tier,'MISSING');
 assert.equal(audit.tierOf(undefined).tier,'MISSING');
});
test('missing data is classified by cause using real reason codes',()=>{
 const cases=[
  [missing('PROVIDER_DISABLED_LICENSE_UNVERIFIED'),'LICENSE_OR_PERMISSION_GATED'],
  [missing('ISSUER_CIRCULATION_PERMISSION_REQUIRED'),'LICENSE_OR_PERMISSION_GATED'],
  [missing('TOKENOMIST_CREDENTIALS_REQUIRED','SOURCE_API_FAILED'),'LICENSE_OR_PERMISSION_GATED'],
  [missing('UNLOCK_ADAPTER_UNSUPPORTED','UNSUPPORTED'),'UNSUPPORTED_ADAPTER'],
  [missing('UNLOCK_SOURCE_FAILED','SOURCE_API_FAILED'),'PROVIDER_FAILURE'],
  [missing('CARD_SOURCE_FAILED','SOURCE_API_FAILED'),'PROVIDER_FAILURE'],
  [missing('BLOCKSCOUT_HOLDERS_HTTP_403'),'PROVIDER_FAILURE'],
  [missing('RANKED_SOURCE_API_FAILED'),'PROVIDER_FAILURE'],
  [missing('SOURCE_IDENTITY_MISMATCH'),'IDENTITY_OR_VALIDATION_REJECTED'],
  [missing('SOURCE_BLOCK_MISMATCH'),'IDENTITY_OR_VALIDATION_REJECTED'],
  [missing('INVALID_EVIDENCE'),'IDENTITY_OR_VALIDATION_REJECTED'],
  [missing('HOLDER_SUPPLY_RECONCILIATION_FAILED'),'IDENTITY_OR_VALIDATION_REJECTED'],
  [missing('NO_SOURCE_REPORTED_SCHEDULE','SOURCE_HAS_NO_DATA'),'NO_EVIDENCE'],
  [missing('NO_VERIFIED_NEXT_UNLOCK'),'NO_EVIDENCE'],
  [missing('INSUFFICIENT_EVIDENCE'),'NO_EVIDENCE']
 ];
 for(const [field,expected] of cases)assert.equal(audit.classifyMissing(field),expected,field.reasonCode);
});
test('only the exact Robinhood registry Stock Token identity makes Next Unlock not applicable',()=>{
 const stock={tokenIdentity:{status:'REGISTRY_MATCHED',type:'STOCK_TOKEN',source:'Robinhood official asset registry'}};
 assert.equal(audit.applicability('robinhood','supply','nextUnlock',stock).state,'NOT_APPLICABLE_BY_REGISTRY');
 for(const [n,c,f,r] of [['robinhood','supply','circulatingSupply',stock],['robinhood','holders','holderCount',stock],
  ['arc','supply','nextUnlock',stock],['ethereum','supply','nextUnlock',stock],
  ['robinhood','supply','nextUnlock',{tokenIdentity:{status:'NOT_VERIFIED',type:null,source:null}}],
  ['robinhood','supply','nextUnlock',{tokenIdentity:{status:'REGISTRY_MATCHED',type:'STOCK_TOKEN',source:'Some aggregator'}}],
  ['robinhood','supply','nextUnlock',{}]])
  assert.equal(audit.applicability(n,c,f,r).state,'APPLICABLE',[n,c,f].join('.'));
});
test('summary separates VERIFIED from SOURCE_REPORTED per network, card and field and keeps missing in the denominator',()=>{
 const results=[{network:'ethereum',symbol:'A',
  mechanics:fullCard('mechanics',found('VERIFIED_SOURCE')),
  holders:{holderCount:found('SOURCE_REPORTED'),largestWalletPct:found('SOURCE_REPORTED_RPC_RECONCILED'),top10Pct:found('SOURCE_REPORTED_RPC_RECONCILED'),top20Pct:missing('BLOCKSCOUT_HOLDERS_HTTP_403')},
  supply:{totalSupply:found('ON_CHAIN'),circulatingSupply:missing('PROVIDER_DISABLED_LICENSE_UNVERIFIED'),burnAddressBalance:found('ON_CHAIN'),nextUnlock:missing('NO_VERIFIED_NEXT_UNLOCK')}}];
 const s=audit.summarize(results);
 assert.equal(s.byNetwork.ethereum.applicableFields,12);
 assert.equal(s.byNetwork.ethereum.verified,6);assert.equal(s.byNetwork.ethereum.sourceReported,3);assert.equal(s.byNetwork.ethereum.missing,3);
 assert.equal(s.byNetwork.ethereum.verifiedPct,50);assert.equal(s.byNetwork.ethereum.anyEvidencePct,75);
 assert.equal(s.byNetworkCard.ethereum.holders.verified,0);assert.equal(s.byNetworkCard.ethereum.holders.sourceReported,3);
 assert.equal(s.byNetworkCard.ethereum.holders.missingReasons.PROVIDER_FAILURE,1);
 assert.equal(s.byNetworkCard.ethereum.supply.missingReasons.LICENSE_OR_PERMISSION_GATED,1);
 assert.equal(s.byNetworkCardField.ethereum.supply.nextUnlock.missingReasons.NO_EVIDENCE,1);
 assert.equal(s.byNetworkCard.ethereum.mechanics.verifiedSubtiers.REVIEWED_SOURCE,4);
 assert.equal(s.byNetwork.arc.applicableFields,0);assert.equal(s.byNetwork.arc.verifiedPct,null);
 assert.match(s.sampleWarning,/Fewer than 30/);
});
test('registry not-applicable fields leave the denominator, but a found value is never hidden',()=>{
 const na={state:'NOT_APPLICABLE_BY_REGISTRY'};
 const base={network:'robinhood',symbol:'TSLA',mechanics:fullCard('mechanics',found('ON_CHAIN')),holders:fullCard('holders',found('ON_CHAIN')),
  applicability:{supply:{nextUnlock:na}}};
 const hidden=audit.summarize([{...base,supply:{...fullCard('supply',found('ON_CHAIN')),nextUnlock:missing('NO_VERIFIED_NEXT_UNLOCK')}}]);
 assert.equal(hidden.byNetworkCard.robinhood.supply.applicableFields,3);assert.equal(hidden.byNetworkCard.robinhood.supply.notApplicableFields,1);
 assert.equal(hidden.byNetworkCard.robinhood.supply.verifiedPct,100);
 const kept=audit.summarize([{...base,supply:fullCard('supply',found('SOURCE_REPORTED'))}]);
 assert.equal(kept.byNetworkCard.robinhood.supply.applicableFields,4);assert.equal(kept.byNetworkCard.robinhood.supply.notApplicableFields,0);
});
test('a failed report counts all audited fields as missing; a card absent from an older capture is NOT_MEASURED, not missing',()=>{
 const s=audit.summarize([{network:'arc',symbol:'X',error:'TimeoutError'},
  {network:'arc',symbol:'OLD',mechanics:fullCard('mechanics',found('ON_CHAIN')),supply:fullCard('supply',found('ON_CHAIN'))}]);
 assert.equal(s.byNetwork.arc.applicableFields,20);
 assert.equal(s.byNetwork.arc.missingReasons.REPORT_FAILED,12);
 assert.deepEqual(s.notMeasured,[{network:'arc',symbol:'OLD',cardId:'holders'}]);
 assert.equal(s.byNetworkCard.arc.holders.applicableFields,4,'only the failed report contributes holder fields');
});
test('environment sanitizer removes write-capable credentials and records presence only',()=>{
 const env={PATH:'/bin',HOME:'/h',ETH_RPC_URL:'https://rpc.example/v2/supersecretkey',BLOCKSCOUT_API_KEY:'proapi_abcdefgh123',
  ARC_HOLDER_QUEUE_URL:'https://q.example',ARC_HOLDER_QUEUE_TOKEN:'tok-123456',CRON_SECRET:'cron-secret-1',AWS_SECRET_ACCESS_KEY:'zzz-unrelated'};
 const clean=audit.sanitizeEnv({...env},'clean');
 assert.equal(clean.presence.BLOCKSCOUT_API_KEY,false);assert.deepEqual(clean.secrets,[]);
 const live={...env},prod=audit.sanitizeEnv(live,'production-equivalent');
 assert.deepEqual(Object.keys(live).sort(),['BLOCKSCOUT_API_KEY','ETH_RPC_URL','PATH','VERCEL']);
 assert.equal(live.VERCEL,'1');
 assert.equal(prod.presence.BLOCKSCOUT_API_KEY,true);assert.equal(prod.presence.ETH_RPC_URL,true);assert.equal(prod.presence.ARC_HOLDER_PUBLISHED_URL,false);
 assert.ok(!('ARC_HOLDER_QUEUE_URL' in prod.presence),'queue configuration is never even reported');
 assert.ok(!JSON.stringify({presence:prod.presence,mode:prod.mode}).includes('supersecretkey'));
 assert.throws(()=>audit.sanitizeEnv({},'inherit-everything'));
});
test('redaction removes secret values, credential query parameters and URL credentials',()=>{
 const out=audit.redact({a:'https://api.blockscout.com/4663/api/v2/tokens/x?apikey=proapi_abcdefgh123&page=2',
  b:['see https://user:pass@rpc.example/path'],c:{d:'value supersecretkey here'}},['supersecretkey']);
 const text=JSON.stringify(out);
 assert.ok(!text.includes('proapi_abcdefgh123'));assert.ok(!text.includes('user:pass'));assert.ok(!text.includes('supersecretkey'));
 assert.match(out.a,/page=2/);
});
test('cohort files are validated and de-duplicated by exact chain and contract',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cohort-'));
 const file=(name,data)=>{const p=path.join(dir,name);fs.writeFileSync(p,JSON.stringify(data));return p;};
 assert.deepEqual(audit.loadCohort(file('ok.json',[{network:'arc',symbol:'A',address:'0x'+'A'.repeat(40)}])),[['arc','A','0x'+'a'.repeat(40)]]);
 assert.throws(()=>audit.loadCohort(file('dup.json',[{network:'arc',address:'0x'+'1'.repeat(40)},{network:'arc',address:'0x'+'1'.repeat(40)}])),/Duplicate/);
 assert.throws(()=>audit.loadCohort(file('bad.json',[{network:'base',address:'0x'+'1'.repeat(40)}])));
 assert.equal(audit.loadCohort(null).length,9);
 assert.equal(audit.blockNumber('0x1ace790'),'28108688');assert.equal(audit.blockNumber('latest'),null);
});
test('end-to-end audit records git, block and UTC metadata, measures Holder & Whale, and never writes secret values',async()=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'audit-repo-'));
 fs.mkdirSync(path.join(repo,'search/server/lib'),{recursive:true});
 fs.copyFileSync(path.join(__dirname,'../search/server/schema.js'),path.join(repo,'search/server/schema.js'));
 fs.writeFileSync(path.join(repo,'search/server/lib/multichain-service.js'),`'use strict';
 const f=(status,value)=>({dataState:'DATA_FOUND',status,value,source:'stub',evidence:[{sourceUrl:'https://x.example/?apikey='+process.env.BLOCKSCOUT_API_KEY}]});
 const m=(code)=>({dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',value:null,reasonCode:code});
 module.exports={async report({network,address}){
  if(address.startsWith('0x0000'))throw Object.assign(Error('https://secret.example/'+process.env.ETH_RPC_URL),{code:'CHAIN_SCAN_UNAVAILABLE'});
  return {network,address,chainId:4663,block:'0x10',tokenIdentity:{status:'REGISTRY_MATCHED',type:'STOCK_TOKEN',source:'Robinhood official asset registry'},
   cards:{mechanics:{fields:{tradingTaxes:f('VERIFIED_SOURCE','Transfer 0%'),mintCapability:m('MINT_NOT_VERIFIED'),ownerAdmin:f('GETTER_REPORTED','owner '+process.env.ETH_RPC_URL),contractArchitecture:f('ON_CHAIN','x')}},
    holders:{fields:{holderCount:f('SOURCE_REPORTED',10),largestWalletPct:f('SOURCE_REPORTED_RPC_RECONCILED',5),top10Pct:m('BLOCKSCOUT_HOLDERS_HTTP_403'),top20Pct:m('BLOCKSCOUT_HOLDERS_HTTP_403')}},
    supply:{fields:{totalSupply:f('ON_CHAIN','1'),circulatingSupply:m('INSUFFICIENT_EVIDENCE'),burnAddressBalance:f('ON_CHAIN','0'),nextUnlock:m('NO_VERIFIED_NEXT_UNLOCK')},context:{}}}};
 }};`);
 const cohort=path.join(repo,'cohort.json');
 fs.writeFileSync(cohort,JSON.stringify([{network:'robinhood',symbol:'TSLA',address:'0x'+'3'.repeat(40)},{network:'ethereum',symbol:'FAIL',address:'0x0000'+'1'.repeat(36)}]));
 const output=path.join(repo,'out.json');
 const savedEnv={...process.env},savedLog=console.log;
 process.env.BLOCKSCOUT_API_KEY='proapi_supersecret99';process.env.ETH_RPC_URL='https://rpc.example/v2/rpcsecret777';
 process.env.ARC_HOLDER_QUEUE_TOKEN='queue-secret-55';
 console.log=()=>{};
 try{await audit.runAudit(repo,output,{envMode:'production-equivalent',cohortFile:cohort});}
 finally{
  console.log=savedLog;
  for(const k of Object.keys(process.env))if(!(k in savedEnv))delete process.env[k];
  Object.assign(process.env,savedEnv);
 }
 const text=fs.readFileSync(output,'utf8'),doc=JSON.parse(text);
 for(const secret of ['proapi_supersecret99','rpcsecret777','queue-secret-55'])assert.ok(!text.includes(secret),'leaked '+secret);
 assert.equal(doc.schemaVersion,2);
 assert.equal(doc.run.environment.presence.BLOCKSCOUT_API_KEY,true);
 assert.equal(doc.run.git.sha,null,'a non-git directory reports no SHA rather than a guess');
 assert.match(doc.run.startedAt,/Z$/);assert.match(doc.run.finishedAt,/Z$/);
 const ok=doc.results.find(r=>r.symbol==='TSLA'),bad=doc.results.find(r=>r.symbol==='FAIL');
 assert.equal(ok.block,'0x10');assert.equal(ok.blockNumber,'16');assert.match(ok.startedAt,/Z$/);
 assert.equal(ok.holders.holderCount.status,'SOURCE_REPORTED');
 assert.equal(ok.applicability.supply.nextUnlock.state,'NOT_APPLICABLE_BY_REGISTRY');
 assert.equal(bad.error,'CHAIN_SCAN_UNAVAILABLE');assert.equal(bad.block,undefined);
 const rh=doc.coverage.byNetworkCard.robinhood;
 assert.equal(rh.holders.verified,0);assert.equal(rh.holders.sourceReported,2);assert.equal(rh.holders.missingReasons.PROVIDER_FAILURE,2);
 assert.equal(rh.supply.notApplicableFields,1);assert.equal(rh.supply.applicableFields,3);
 assert.equal(doc.coverage.byNetwork.ethereum.missingReasons.REPORT_FAILED,12);
});
test('offline re-summary of an older capture never counts an unmeasured Holder card as missing',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'resum-'));
 const input=path.join(dir,'in.json'),output=path.join(dir,'out.json');
 fs.writeFileSync(input,JSON.stringify({mode:'old',results:[{network:'ethereum',symbol:'USDC',block:'0x1',
  mechanics:fullCard('mechanics',found('VERIFIED_SOURCE')),supply:fullCard('supply',found('ON_CHAIN'))}]}));
 const doc=audit.summarizeCapture(input,output);
 assert.equal(doc.coverage.byNetworkCard.ethereum.holders.applicableFields,0);
 assert.deepEqual(doc.coverage.notMeasured,[{network:'ethereum',symbol:'USDC',cardId:'holders'}]);
 assert.equal(doc.coverage.byNetwork.ethereum.verifiedPct,100);
 assert.ok(fs.existsSync(output));
});
