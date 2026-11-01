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
   // One intentional strength upgrade: a prior owner() address-only getter can
   // become reviewed owner-governance evidence for the SAME full 20-byte address.
   // Never allow the reverse, a new owner, a mint/tax change, or a weaker source.
   if(y.value!==x.value||y.status!==x.status){
    const oldOwner=(x.value||'').startsWith('owner() getter: ')?x.value.slice('owner() getter: '.length):null;
    const newOwner=/0x[0-9a-f]{40}/i.exec(y.value||'')?.[0];
    const upgrade=f==='ownerAdmin'&&x.status==='GETTER_REPORTED'&&y.status==='VERIFIED_SOURCE_AND_STATE'&&
      x.cls==='SINGLE_SOURCE'&&y.cls==='ON_CHAIN_VERIFIED'&&oldOwner&&/^0x[0-9a-f]{40}$/i.test(oldOwner)&&newOwner&&oldOwner.toLowerCase()===newOwner.toLowerCase();
    assert.ok(upgrade,'Previously verified field changed without same-owner stronger proof: '+id+'/'+f+' old='+x.value+' new='+y.value);
   }}
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
