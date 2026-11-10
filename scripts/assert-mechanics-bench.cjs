'use strict';
// Fail-closed paired coverage regression check. Offline: reads only benchmark JSON artifacts.
const fs=require('node:fs'),assert=require('node:assert/strict');
const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw Error('Usage: node scripts/assert-mechanics-bench.cjs BEFORE.json AFTER.json');
const before=JSON.parse(fs.readFileSync(beforePath,'utf8'));
const after=JSON.parse(fs.readFileSync(afterPath,'utf8'));
assert.equal(before.mode,'replay');assert.ok(['replay','augment'].includes(after.mode),'AFTER must be a replay (augment = replay + budgeted kinds only)');
assert.equal(before.rows.length,after.rows.length,'Benchmark sample count changed');
assert.ok(before.rows.length>=30,'Insufficient sample size');
const FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
const key=r=>r.chain+'|'+r.address.toLowerCase()+'|'+(r.group||'');
const seen=new Set();const PROBE_BUDGET=2,SIBLING_BUDGET=3,REVIEWED_BUDGET=8,CUSTOM_ROLE_BUDGET=20,budgets={probe:0,sibling:0,reference:0,reviewed:0,customRole:0,probeContracts:0,siblingContracts:0,reviewedContracts:0,customRoleContracts:0};const stats=Object.fromEntries(FIELDS.map(f=>[f,{before:0,after:0,gain:0}]));
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
    // The same rule covers an enumerated DEFAULT_ADMIN_ROLE member that becomes reviewed role-governance evidence.
    const oldOwner=(x.value||'').startsWith('owner() getter: ')?x.value.slice('owner() getter: '.length):(x.value||'').startsWith('DEFAULT_ADMIN_ROLE: ')?x.value.slice('DEFAULT_ADMIN_ROLE: '.length):null;
    const newOwner=/0x[0-9a-f]{40}/i.exec(y.value||'')?.[0];
    const upgrade=f==='ownerAdmin'&&x.status==='GETTER_REPORTED'&&y.status==='VERIFIED_SOURCE_AND_STATE'&&
      x.cls==='SINGLE_SOURCE'&&y.cls==='ON_CHAIN_VERIFIED'&&oldOwner&&/^0x[0-9a-f]{40}$/i.test(oldOwner)&&newOwner&&oldOwner.toLowerCase()===newOwner.toLowerCase();
    assert.ok(upgrade,'Previously verified field changed without same-owner stronger proof: '+id+'/'+f+' old='+x.value+' new='+y.value);
   }}
  stats[f].before+=Number(x.ok);stats[f].after+=Number(y.ok);
  if(!x.ok&&y.ok)stats[f].gain++;
 }
 // Evidence-based request budgets (augment replay). Everything outside a budgeted kind must not grow.
 const probe=a.net.augProbe||0,siblingCalls=a.net.augSibling||0,reference=a.net.augReference||0,reviewed=a.net.augReviewed||0,customRole=a.net.augCustomRole||0;
 assert.ok(a.net.rpc-probe-siblingCalls-reviewed-customRole<=b.net.rpc,'New RPC usage for '+id);
 assert.ok(reviewed<=REVIEWED_BUDGET,'Reviewed-profile read budget exceeded for '+id+' ('+reviewed+'>'+REVIEWED_BUDGET+')');
 assert.ok(customRole<=CUSTOM_ROLE_BUDGET,'Custom AccessControl role read budget exceeded for '+id+' ('+customRole+'>'+CUSTOM_ROLE_BUDGET+')');
 if(reviewed)assert.ok(!b.f.tradingTaxes.ok,'Reviewed-profile reads spent on an already verified tax row: '+id);
 assert.ok(a.net.sourcify-reference<=b.net.sourcify,'New Sourcify usage for '+id);
 assert.ok(probe<=PROBE_BUDGET,'Proxy delegation probe budget exceeded for '+id+' ('+probe+'>'+PROBE_BUDGET+')');
 assert.ok(siblingCalls<=SIBLING_BUDGET,'Sibling getter budget exceeded for '+id+' ('+siblingCalls+'>'+SIBLING_BUDGET+')');
 assert.ok(reference<=1,'Sibling reference fetched more than once for '+id);
 // Eligibility: no budgeted request for a contract whose relevant field was already verified on main.
 if(probe)assert.ok(!b.f.contractArchitecture.ok,'Delegation probe spent on an already verified architecture: '+id);
 if(siblingCalls||reference)assert.ok(b.chain==='robinhood'&&['tradingTaxes','mintCapability','ownerAdmin'].every(f=>!b.f[f].ok),'Sibling budget spent on an ineligible/verified contract: '+id);
 budgets.probe+=probe;budgets.sibling+=siblingCalls;budgets.reference+=reference;budgets.reviewed+=reviewed;budgets.customRole+=customRole;if(reviewed)budgets.reviewedContracts++;if(probe)budgets.probeContracts++;if(siblingCalls)budgets.siblingContracts++;if(customRole)budgets.customRoleContracts++;
 assert.ok(a.net.replayMiss<=b.net.replayMiss,'New unmatched replay request for '+id);
}
for(const category of ['goplus','explorer','other','replayMiss']){
 assert.ok((after.net[category]||0)<=(before.net[category]||0),'Request/replay regression: '+category);
}
assert.ok(after.net.rpc-(after.net.augProbe||0)-(after.net.augSibling||0)-(after.net.augReviewed||0)-(after.net.augCustomRole||0)<=before.net.rpc,'Request/replay regression: rpc');
assert.ok(after.net.sourcify-(after.net.augReference||0)<=before.net.sourcify,'Request/replay regression: sourcify');
assert.equal(before.net.augProbe||0,0,'BEFORE must not use budgeted requests');assert.equal(before.net.augSibling||0,0);assert.equal(before.net.augReference||0,0);assert.equal(before.net.augReviewed||0,0);assert.equal(before.net.augCustomRole||0,0);
const summary={samples:before.rows.length,coverage:stats,budgets,requests:{before:before.net,after:after.net},replayComplete:before.net.replayMiss===0&&after.net.replayMiss===0};
console.log('PAIRED_MECHANICS_GATE PASS '+JSON.stringify(summary));
if(!summary.replayComplete)console.warn('WARNING: missing recorded responses were fail-closed; the replay is not complete. No live fallback was used.');
