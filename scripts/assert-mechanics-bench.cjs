'use strict';
// Fail-closed paired coverage regression check. Offline: reads only benchmark JSON artifacts.
const fs=require('node:fs'),assert=require('node:assert/strict');
const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw Error('Usage: node scripts/assert-mechanics-bench.cjs BEFORE.json AFTER.json');
const before=JSON.parse(fs.readFileSync(beforePath,'utf8'));
const after=JSON.parse(fs.readFileSync(afterPath,'utf8'));
assert.equal(before.mode,'replay');assert.equal(after.mode,'replay');
assert.equal(before.rows.length,after.rows.length,'Benchmark sample count changed');
assert.ok(before.rows.length>=30,'Insufficient sample size');
const FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
const key=r=>r.chain+'|'+r.address.toLowerCase()+'|'+(r.group||'');
const seen=new Set();const stats=Object.fromEntries(FIELDS.map(f=>[f,{before:0,after:0,gain:0}]));
for(let i=0;i<before.rows.length;i++){
 const b=before.rows[i],a=after.rows[i],id=key(b);
 assert.equal(key(a),id,'Sample order/identity changed');
 assert.ok(!seen.has(id),'Duplicate sample: '+id);seen.add(id);
 assert.equal(a.block,b.block,'Different evidence block for '+id);
 assert.equal(a.err,b.err,'New contract inspection error for '+id);
 for(const f of FIELDS){
  const x=b.f[f],y=a.f[f];
  assert.ok(x&&y,'Missing field '+f+' for '+id);
  if(x.ok){assert.equal(y.ok,true,'Verified field lost: '+id+'/'+f);
   assert.equal(y.value,x.value,'Previously verified value changed: '+id+'/'+f);
   assert.equal(y.status,x.status,'Previously verified status changed: '+id+'/'+f);}
  stats[f].before+=Number(x.ok);stats[f].after+=Number(y.ok);
  if(!x.ok&&y.ok)stats[f].gain++;
 }
 assert.ok(a.net.rpc<=b.net.rpc,'New RPC usage for '+id);
 assert.ok(a.net.sourcify<=b.net.sourcify,'New Sourcify usage for '+id);
 assert.ok(a.net.replayMiss<=b.net.replayMiss,'New unmatched replay request for '+id);
}
for(const category of ['rpc','sourcify','goplus','explorer','other','replayMiss']){
 assert.ok((after.net[category]||0)<=(before.net[category]||0),'Request/replay regression: '+category);
}
const summary={samples:before.rows.length,coverage:stats,requests:{before:before.net,after:after.net},replayComplete:before.net.replayMiss===0&&after.net.replayMiss===0};
console.log('PAIRED_MECHANICS_GATE PASS '+JSON.stringify(summary));
if(!summary.replayComplete)console.warn('WARNING: missing recorded responses were fail-closed; the replay is not complete. No live fallback was used.');
