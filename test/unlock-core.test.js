'use strict';
// Shared pure Unlock core (#83): real and adversarial fixtures, and cross-runtime parity between the Node worker collector
// (lib/unlock-calendar.js) and the Vercel route (api/unlocks.js) fed the SAME publisher responses.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../lib/unlock-core.cjs'),worker=require('../lib/unlock-calendar');
const root=path.join(__dirname,'..');
const day=n=>new Date(Date.now()+n*86400000);
const fmt=d=>d.getUTCDate()+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]+' '+d.getUTCFullYear();
const row=(n,date,name,symbol,amount,allocation='Team',percent='1.2%')=>`<tr><td>${n}</td><td>${name} ${symbol}</td><td>${fmt(date)}</td><td>${amount}</td><td>$10M</td><td>${percent}</td><td>${allocation}</td></tr>`;
const table=rows=>'<table><tbody>'+rows.join('')+'</tbody></table>';

test('parseFeed: valid rows, drift detection and per-reason rejection counts',()=>{
 const ok=core.parseFeed(table([row(1,day(2),'Celestia','TIA','10M TIA'),row(2,day(3),'Aptos','APT','5.5M APT','Core')]),'https://api.coinbell.in/token-unlocks?sort=soonest&window=30',Date.now());
 assert.equal(ok.rows.length,2);assert.equal(ok.diagnostics.drift,false);assert.equal(ok.diagnostics.dataRows,2);
 // publisher changes the date column to ISO text: every data row fails -> a SOURCE problem, not "no events"
 const moved=table(Array.from({length:8},(_,i)=>`<tr><td>${i+1}</td><td>Token${i} T${i}</td><td>2026-12-0${(i%8)+1}</td><td>10M T${i}</td><td>$1</td><td>1%</td><td>Team</td></tr>`));
 const d=core.parseFeed(moved,'u',Date.now());
 assert.equal(d.rows.length,0);assert.equal(d.diagnostics.drift,true);assert.equal(d.diagnostics.rejected.NO_DATE,8);
 // a page with a table but no recognisable data rows is drift as well; an empty page is simply empty
 assert.equal(core.parseFeed('<table><tr><td>x</td></tr></table>','u').diagnostics.driftReason,'NO_RECOGNISED_DATA_ROWS');
 assert.equal(core.parseFeed('<html>no table</html>','u').diagnostics.drift,false);
 // mostly-invalid rows (invalid amount text) trip the 60 % rule; HTML/script injection is stripped
 const mixed=table([...Array.from({length:6},(_,i)=>row(i+1,day(2),'Bad'+i,'B'+i,'lots of B'+i)),row(7,day(2),'Good','GD','1M GD')]);
 assert.equal(core.parseFeed(mixed,'u').diagnostics.driftReason,'MOST_ROWS_FAILED_VALIDATION');
 const xss=core.parseFeed(table([row(1,day(2),'<script>alert(1)</script>Evil<img src=x onerror=1>','EVL','1M EVL')]),'u').rows[0];
 assert.doesNotMatch(JSON.stringify(xss),/<|onerror=1>/);
 // impossible dates are rejected
 assert.equal(core.isoDate('31 Feb 2026'),null);
});

test('amountKey: locale-safe comparison, ambiguity is flagged and never silently resolved',()=>{
 assert.equal(core.amountKey('1,234.56 TIA').key,core.amountKey('1.234,56 TIA').key,'both separators: last one is the decimal');
 assert.equal(core.amountKey('1,234,567 TIA').key,core.amountKey('1.234.567 TIA').key);
 assert.equal(core.amountKey('1.234 TIA').ambiguous,true,'lone group of three digits is ambiguous without a suffix');
 assert.equal(core.amountKey('1.234M TIA').ambiguous,false,'a K/M/B suffix makes it a decimal');
 assert.equal(core.amountKey('1.234M TIA').key,core.amountKey('1234K TIA').key);
 assert.equal(core.amountKey('0 TIA').key,null);assert.equal(core.amountKey('abc').key,null);
 assert.notEqual(core.amountKey('10M TIA').key,core.amountKey('10M APT').key,'symbol is part of the identity');
});

test('safeSourceUrl / safeLogoUrl: no phishing or credential links, host allowlist, https only',()=>{
 assert.ok(core.safeSourceUrl('https://api.coinbell.in/token-unlocks?sort=soonest&window=30'));
 for(const bad of ['http://api.coinbell.in/x','https://user:pw@api.coinbell.in/x','https://api.coinbell.in:8443/x','https://api.coinbell.in.evil.example/x','https://xn--coinbell-in-x9b.com/x','https://127.0.0.1/x','https://[::1]/x','javascript:alert(1)','data:text/html,x','//evil.example','not a url'])
  assert.equal(core.safeSourceUrl(bad),null,bad);
 assert.ok(core.safeSourceUrl('https://docs.project.example/vesting',['docs.project.example']),'reviewed project host');
 assert.equal(core.safeSourceUrl('https://docs.project.example/vesting'),null,'not allowlisted by default');
 assert.equal(core.safeLogoUrl('data:image/svg+xml,<svg onload=1>'),'');assert.equal(core.safeLogoUrl('http://x.example/a.png'),'');assert.equal(core.safeLogoUrl('https://10.0.0.1/a.png'),'');
 assert.ok(core.safeLogoUrl('https://cdn.example/a.png'));
});

test('scheduleBasis comes only from explicit text; months of data never imply linear vesting',()=>{
 assert.equal(core.scheduleBasis('Team (Cliff)'),'CLIFF_TEXT');assert.equal(core.scheduleBasis('Investors linear'),'LINEAR_TEXT');
 assert.equal(core.scheduleBasis('Cliff + linear'),'CLIFF_AND_LINEAR_TEXT');assert.equal(core.scheduleBasis('Estimated team release'),'ESTIMATED');
 assert.equal(core.scheduleBasis('Team monthly'),'UNSPECIFIED');assert.equal(core.scheduleBasis(''),'UNSPECIFIED');
});

test('sanitizeEvents: conflicting amounts are quarantined, namesakes and versions stay separate, bad links removed',()=>{
 const base={verification:'source-published',date:'2026-12-01',allocation:'Team',sourceUrl:'https://api.coinbell.in/token-unlocks',evidence:[{url:'https://api.coinbell.in/token-unlocks'}]};
 const ev=[
  {...base,name:'Alpha',symbol:'ALP',amount:'10M ALP'},{...base,name:'Alpha',symbol:'ALP',amount:'12M ALP'},            // same identity, different amount -> conflict
  {...base,name:'Beta Chain',symbol:'BET',amount:'5M BET'},{...base,name:'Beta Finance',symbol:'BET',amount:'9M BET'}, // namesake tickers
  {...base,name:'Gamma',symbol:'GAM',amount:'1M GAM',sourceUrl:'https://evil.example/login',evidence:[{url:'https://evil.example/login'}],logo:'http://x.example/a.png'},
  {...base,name:'Delta',symbol:'DEL',amount:'1.234 DEL',allocation:'Investors (linear)'},
  {...base,name:'Eps',symbol:'EPS',amount:'1,000 EPS'},{...base,name:'Eps',symbol:'EPS',amount:'1.000 EPS'}              // ambiguous vs thousands: same value only if read as 1000
 ];
 const out=core.sanitizeEvents(ev);
 assert.equal(out.conflicts.length,1,JSON.stringify(out.conflicts));assert.equal(out.conflicts[0].identity[0],'alpha');
 assert.ok(!out.events.some(e=>e.symbol==='ALP'),'neither conflicting amount is shown');
 assert.equal(out.events.filter(e=>e.symbol==='BET').length,2);
 const gamma=out.events.find(e=>e.symbol==='GAM');assert.equal(gamma.sourceUrl,'');assert.equal(gamma.sourceLinkStatus,'BLOCKED_OR_ABSENT');assert.deepEqual(gamma.evidence,[]);assert.equal(gamma.logo,'');
 const delta=out.events.find(e=>e.symbol==='DEL');assert.equal(delta.scheduleBasis,'LINEAR_TEXT');assert.equal(delta.amountFormat,'AMBIGUOUS_SEPARATORS');
 assert.equal(out.events.find(e=>e.symbol==='ALP'),undefined);
});

// ---------- cross-runtime parity ----------
function apiContext(fetchImpl){
 const evidence=fs.readFileSync(path.join(root,'lib/unlock-evidence.js'),'utf8').replaceAll('export const','const');
 const src=fs.readFileSync(path.join(root,'api/unlocks.js'),'utf8').replace(/^import .*(?:unlock-evidence|unlock-core).*;\r?\n/gm,'').replace('export default async function handler','async function handler');
 const ctx=vm.createContext({process:{env:{}},Date,URL,URLSearchParams,AbortSignal,TextEncoder,atob,fetch:fetchImpl,core});
 vm.runInContext(evidence,ctx);vm.runInContext(src,ctx);return ctx;
}
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}});
const ident=e=>[e.name,e.symbol,e.date,e.amount,e.allocation].join('|');
async function both(pages){
 const fetcher=async url=>{const k=['soonest','impact','value'].find(s=>url.includes('sort='+s));const p=pages[k];
  if(p instanceof Error)throw p;if(typeof p==='number')return {ok:false,status:p,headers:{get:h=>h==='retry-after'?'120':null},text:async()=>''};
  return {ok:true,status:200,headers:{get:()=>null},text:async()=>p};};
 const w=await worker.generate({fetcher});
 const ctx=apiContext(fetcher),r=res();await ctx.handler({query:{}},r);
 return {w,a:r.body,code:r.code};
}
test('PARITY: identical publisher responses produce identical events, conflicts, source statuses and failure reasons in worker and Vercel route',async()=>{
 const soon=table([row(1,day(2),'Celestia','TIA','10M TIA'),row(2,day(3),'Aptos','APT','5.5M APT','Core'),row(3,day(4),'Alpha','ALP','10M ALP')]);
 const impact=table([row(1,day(2),'Celestia','TIA','10M TIA'),row(2,day(4),'Alpha','ALP','12M ALP'),row(3,day(5),'Beta Chain','BET','5M BET'),row(4,day(5),'Beta Finance','BET','9M BET')]);
 const {w,a,code}=await both({soonest:soon,impact,value:429});
 assert.equal(code,200);
 assert.equal(JSON.stringify(w.events.map(ident).sort()),JSON.stringify(a.events.map(ident).sort()),'same event set');
 assert.ok(!w.events.some(e=>e.symbol==='ALP')&&!a.events.some(e=>e.symbol==='ALP'),'conflicting amounts withheld in BOTH runtimes');
 assert.equal(w.events.filter(e=>e.symbol==='TIA').length,1,'same provider sorted views de-duplicated');
 assert.equal(w.events.filter(e=>e.symbol==='BET').length,2,'namesake tickers never merged');
 const fail=x=>x.coverage.sources.map(s=>[s.status,s.reason||null,s.retryAfterSeconds??null]);
 assert.equal(JSON.stringify(fail(w)),JSON.stringify(fail(a)));assert.equal(JSON.stringify(fail(a)[2]),JSON.stringify(['unavailable','SOURCE_HTTP_429',120]),'429 + Retry-After is reported, not silently zero');
 assert.equal(w.partial,true);assert.equal(a.partial,true);
 for(const e of [...w.events,...a.events]){assert.equal(e.executionVerification,'NOT_VERIFIED');assert.equal(e.scheduleStatus,'SCHEDULED');assert.ok(e.scheduleBasis);}
});
test('PARITY: markup drift in one sorted view is a source failure in both runtimes; total outage is fail-closed 503, never zero events',async()=>{
 const good=table([row(1,day(2),'Celestia','TIA','10M TIA')]);
 const drift=table(Array.from({length:6},(_,i)=>`<tr><td>${i+1}</td><td>T${i} T${i}</td><td>soon</td><td>1M T${i}</td><td>$1</td><td>1%</td><td>x</td></tr>`));
 const {w,a}=await both({soonest:good,impact:drift,value:good});
 for(const x of [w,a]){assert.equal(x.coverage.sources[1].status,'unavailable');assert.equal(x.coverage.sources[1].reason,'SOURCE_MARKUP_DRIFT');assert.equal(x.events.length,1);assert.equal(x.partial,true);}
 const ctx=apiContext(async()=>{throw new Error('offline');}),r=res();await ctx.handler({query:{}},r);
 assert.equal(r.code,503);assert.equal(r.body.ok,false);assert.equal(r.body.events.length,0);
 await assert.rejects(worker.generate({fetcher:async()=>{throw new Error('offline');}}),/UNLOCK_DISCOVERY_UNAVAILABLE/);
});
test('PARITY: a tampered/older signed edition with conflicting amounts or a hostile link is sanitised by the Vercel route',()=>{
 const ctx=apiContext(async()=>{throw Error('x');});
 const today=new Date().toISOString().slice(0,10),id=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
 const e=(name,amount,url)=>({name,symbol:'ZZZ',date:id,amount,allocation:'Team',percent:'1%',value:'',source:'CoinBell / DefiLlama',sourceUrl:url,verification:'source-published',evidence:[{url,kind:'published-calendar',checkedAt:new Date().toISOString()}]});
 const edition={schemaVersion:1,success:true,generatedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),refreshAt:new Date(Date.now()+6*3600000).toISOString(),windows:{today:[],next7:[],days8to30:[]},
  events:[e('Zed','1M ZZZ','https://api.coinbell.in/token-unlocks'),e('Zed','9M ZZZ','https://api.coinbell.in/token-unlocks'),e('Yo','2M YOO','https://evil.example/phish')]};
 edition.events[2].symbol='YOO';
 const out=ctx.safeCurrentEdition(edition);
 assert.ok(!out.events.some(x=>x.name==='Zed'),'conflicting amounts withheld');
 assert.equal(out.coverage.editionConflicts.length,1);assert.equal(out.partial,true);
 const yo=out.events.find(x=>x.name==='Yo');assert.equal(yo.sourceUrl,'');assert.equal(yo.sourceLinkStatus,'BLOCKED_OR_ABSENT');
 void today;
});

test('executionVerification: ONCHAIN_VERIFIED only with a complete transaction proof; a calendar row never qualifies',()=>{
 const ok={chainId:1,txHash:'0x'+'a'.repeat(64),block:123};
 assert.equal(core.executionVerification({executionProof:ok}),'ONCHAIN_VERIFIED');
 for(const bad of [undefined,{},{...ok,txHash:'0x12'},{...ok,chainId:0},{...ok,block:-1},{...ok,block:'1'},{chainId:1,txHash:ok.txHash}])
  assert.equal(core.executionVerification({executionProof:bad}),'NOT_VERIFIED');
 assert.equal(core.executionVerification({verification:'project-confirmed',date:'2026-12-01'}),'NOT_VERIFIED','a project-confirmed SCHEDULE is not an execution');
});
