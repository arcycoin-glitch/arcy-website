#!/usr/bin/env node
'use strict';
// Read-only, paired mobile Lighthouse lab test: SAME GitHub runner/browser/network for base and PR.
// Preview is protected from anonymous GitHub Actions; do NOT disable Vercel protection.
// Self-contained static servers have no live API access, so scores measure first-screen
// render of the same site files, not end-to-end Production network/interactive performance.
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const baseDir=path.resolve(process.cwd(),'../baseline');
const candDir=process.cwd();
const targets={baseline:'http://127.0.0.1:8123/',candidate:'http://127.0.0.1:8124/'};
const runs=Math.max(2,Math.min(3,Number(process.env.MOBILE_RUNS)||3));
const servers=[];
function start(dir,port){
 const p=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1','--directory',dir],{stdio:'ignore'});
 servers.push(p);return p;
}
function med(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null;}
async function probe(url){
 for(let i=0;i<60;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1200)});if(r.ok)return await r.text();}catch{}await new Promise(r=>setTimeout(r,100));}
 throw Error('Local static server did not start: '+url);
}
(async()=>{
 if(!fs.existsSync(path.join(baseDir,'index.html'))||!fs.existsSync(path.join(candDir,'index.html')))throw Error('Paired checkout unavailable');
 start(baseDir,8123);start(candDir,8124);
 const initial={};for(const [k,u] of Object.entries(targets)){
  const html=await probe(u);
  if(!html.includes('ARCY SEARCH'))throw Error(k+' is not ARCY SEARCH');
  initial[k]={bytes:Buffer.byteLength(html),externalCommunity:html.includes('src="/assets/arcy-community-illustration.webp"'),embeddedCommunity:html.includes('data:image/webp;base64,')};
 }
 if(!(initial.candidate.bytes<initial.baseline.bytes&&initial.baseline.embeddedCommunity&&!initial.candidate.embeddedCommunity))throw Error('Expected exact scoped HTML reduction');
 const records={baseline:[],candidate:[]};
 for(let n=1;n<=runs;n++)for(const [k,url] of Object.entries(targets)){
  const file='mobile-'+k+'-'+n+'.json';
  const args=['-y','lighthouse@12',url,'--quiet','--only-categories=performance','--form-factor=mobile','--screenEmulation.mobile','--throttling-method=simulate','--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage','--max-wait-for-load=60000','--output=json','--output-path='+file];
  const x=spawnSync('npx',args,{encoding:'utf8',timeout:135000});
  if(x.status!==0)throw Error(k+' Lighthouse '+n+' failed: '+(x.stderr||x.stdout||'').slice(-900));
  const data=JSON.parse(fs.readFileSync(file,'utf8')),a=data.audits||{};
  const final=new URL(data.finalDisplayedUrl||data.finalUrl||'about:blank');
  if(final.host!==new URL(url).host)throw Error(k+' unexpectedly redirected');
  const row={lcp:a['largest-contentful-paint']?.numericValue,fcp:a['first-contentful-paint']?.numericValue,cls:a['cumulative-layout-shift']?.numericValue,tbt:a['total-blocking-time']?.numericValue,bytes:a['total-byte-weight']?.numericValue,score:data.categories?.performance?.score,lcpElement:a['largest-contentful-paint-element']?.details?.items?.[0]?.node?.snippet||null};
  if(!Number.isFinite(row.lcp)||!Number.isFinite(row.cls))throw Error(k+' invalid Lighthouse result');
  records[k].push(row);console.log(k+' run='+n+' '+JSON.stringify(row));
 }
 const keys=['lcp','fcp','cls','tbt','bytes','score'];
 const summary={method:'same-runner-paired-local-static-mobile-Lighthouse12',caveat:'Not Vercel end-to-end; no production APIs or CDN.',initial,runs,baseline:Object.fromEntries(keys.map(k=>[k,med(records.baseline.map(r=>r[k]))])),candidate:Object.fromEntries(keys.map(k=>[k,med(records.candidate.map(r=>r[k]))]))};
 summary.lcpImprovementPct=Number(((summary.baseline.lcp-summary.candidate.lcp)/summary.baseline.lcp*100).toFixed(1));
 summary.clsDelta=Number((summary.candidate.cls-summary.baseline.cls).toFixed(4));
 fs.writeFileSync('mobile-lcp-summary.json',JSON.stringify({summary,records},null,2));
 console.log('::notice title=paired-local-mobile-lcp::'+JSON.stringify(summary).slice(0,3600));
 if(summary.lcpImprovementPct < 0 || summary.clsDelta > 0.03)throw Error('Candidate LCP or CLS regressed; leave PR unmerged');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(()=>{servers.forEach(s=>s.kill())});
