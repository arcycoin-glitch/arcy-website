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
const FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture','transferRestrictions'];
const key=r=>r.chain+'|'+r.address.toLowerCase()+'|'+(r.group||'');
const seen=new Set();const PROBE_BUDGET=2,SIBLING_BUDGET=3,REVIEWED_BUDGET=8,CUSTOM_ROLE_BUDGET=20,RESTRICTION_BUDGET=2,BINDING_BUDGET=8,budgets={binding:0,bindingContracts:0,authority:0,authoritySource:0,probe:0,sibling:0,reference:0,reviewed:0,customRole:0,restriction:0,probeContracts:0,siblingContracts:0,reviewedContracts:0,customRoleContracts:0,restrictionContracts:0};const stats=Object.fromEntries(FIELDS.map(f=>[f,{before:0,after:0,gain:0}]));let customRoleEvidenceBefore=0,customRoleEvidenceAfter=0;
for(let i=0;i<before.rows.length;i++){
 const b=before.rows[i],a=after.rows[i],id=key(b);
 assert.equal(key(a),id,'Sample order/identity changed');
 assert.ok(!seen.has(id),'Duplicate sample: '+id);seen.add(id);
 assert.equal(a.block,b.block,'Different evidence block for '+id);
 assert.equal(a.err,b.err,'New contract inspection error for '+id);
 for(const f of FIELDS){
  // transferRestrictions (V5) is absent from artifacts produced before it existed: absent = not verified.
  const absent={ok:false,cls:'NOT_VERIFIED',status:'NOT_VERIFIED',value:'',scope:''};
  const x=b.f[f]||(f==='transferRestrictions'?absent:undefined),y=a.f[f]||(f==='transferRestrictions'&&!x.ok?absent:undefined);
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
    // Mechanics V5: an architecture-only delegation probe may become the reviewed, source-bound proxy of the SAME kind
    // (legacy slot -> reviewed legacy proxy; EIP-1967 -> reviewed EIP-1967 proxy). Never a different kind or a weaker proof.
    const bound=f==='contractArchitecture'&&x.status===y.status&&
      (/^Legacy OpenZeppelin proxy slot · delegation proven$/.test(x.value||'')&&/^Legacy implementation slot$/.test(y.value||'')||
       /^EIP-1967 proxy · delegation proven$/.test(x.value||'')&&/^EIP-1967 implementation(?: · UUPS UUID observed)?$/.test(y.value||''));
    // A strict token-side zero-fee proof may strengthen a partial transfer-only claim ONLY when
    // both observations share the same exact-runtime, fully source-reviewed digest at the same
    // pinned block (already checked above), and the new proof explicitly says direct runtime.
    // The stronger finding excludes DEX/pool/hook swap fees and cannot apply to delegated code.
    const zeroTax=f==='tradingTaxes'&&x.status==='VERIFIED_SOURCE'&&y.status==='VERIFIED_SOURCE_AND_STATE'&&
      x.cls==='SINGLE_SOURCE'&&y.cls==='ON_CHAIN_VERIFIED'&&
      x.value==='Transfer 0% · DEX/hook fees NOT VERIFIED'&&y.value==='Buy 0% · Sell 0% · Transfer 0%'&&
      (y.evidence||[]).some(yp=>yp.coverage==='TOKEN_TAX_ALL_TRANSFERS'&&yp.tokenTaxScope==='TOKEN_CONTRACT_ONLY'&&
       yp.sourceBoundNonDelegatingRuntime===true&&/^[0-9a-f]{64}$/.test(yp.sourceDigest||'')&&
       (x.evidence||[]).some(xp=>xp.sourceDigest===yp.sourceDigest&&
        xp.runtimeMatch===yp.runtimeMatch&&xp.address?.toLowerCase()===yp.address?.toLowerCase()&&xp.block===yp.block));
    assert.ok(upgrade||bound||zeroTax,'Previously verified field changed without same-owner stronger proof: '+id+'/'+f+' old='+x.value+' new='+y.value);
   }}
  stats[f].before+=Number(x.ok);stats[f].after+=Number(y.ok);
  if(!x.ok&&y.ok)stats[f].gain++;
 }
 const roleKey=x=>[x.role,x.method,x.member||'',x.count??'',x.block||''].join('|');
 const beforeRoles=Array.isArray(b.customRoleEvidence)?b.customRoleEvidence:[],afterRoles=Array.isArray(a.customRoleEvidence)?a.customRoleEvidence:[];
 const afterRoleKeys=new Set(afterRoles.map(roleKey));
 for(const item of beforeRoles)assert.ok(afterRoleKeys.has(roleKey(item)),'Custom role evidence lost: '+id+'/'+roleKey(item));
 for(const item of afterRoles){
  assert.ok(['PAUSER_ROLE','BLACKLISTER_ROLE','UPGRADER_ROLE','BURNER_ROLE'].includes(item.role),'Unexpected custom role evidence: '+id);
  assert.ok(['getRoleAdmin','getRoleMemberCount','hasRole'].includes(item.method),'Unexpected custom role evidence method: '+id);
  assert.equal(item.block,a.block,'Custom role evidence was not pinned to the benchmark block: '+id);
  assert.equal(typeof item.scope,'string');assert.ok(item.scope,'Custom role evidence scope missing: '+id);
  if(item.method==='hasRole'&&item.value===true)assert.match(item.member||'',/^0x[0-9a-f]{40}$/i,'Positive membership lacks an address: '+id);
 }
 customRoleEvidenceBefore+=beforeRoles.length;customRoleEvidenceAfter+=afterRoles.length;
 // Evidence-based request budgets (augment replay). Everything outside a budgeted kind must not grow.
 const auth=a.net.augAuthority||0,authSource=a.net.augAuthoritySource||0;
 assert.ok(auth+authSource<=20&&authSource<=4,'Authority graph read budget exceeded for '+id);
 if(auth||authSource){
  const graph=a.audit?.authority;
  assert.ok(graph?.edges?.length&&graph.requests>=auth+authSource&&graph.requests<=20&&graph.sources<=4&&graph.nodes?.length<=6,'Missing bounded authority evidence for '+id);
  for(const edge of graph.edges)assert.ok(edge.block===a.block&&edge.subjectAddress?.toLowerCase()===a.address.toLowerCase()&&edge.evidenceType==='AUTHORITY_EDGE','Unpinned authority edge for '+id);
 }
 budgets.authority+=auth;budgets.authoritySource+=authSource;
 const probe=a.net.augProbe||0,siblingCalls=a.net.augSibling||0,reference=a.net.augReference||0,reviewed=a.net.augReviewed||0,customRole=a.net.augCustomRole||0,restriction=a.net.augRestriction||0,binding=(a.net.augBinding||0)+(a.net.augBindingSource||0);
 assert.ok(a.net.rpc-probe-siblingCalls-reviewed-customRole-restriction-(a.net.augBinding||0)-auth<=b.net.rpc,'New RPC usage for '+id);
 assert.ok(binding<=BINDING_BUDGET,'Proxy-binding read budget exceeded for '+id+' ('+binding+'>'+BINDING_BUDGET+')');
 // Eligible only where main proved delegation for an UNBOUND outer runtime and this branch binds it to reviewed source.
 // A contract that was not newly bound may only use these kinds to replace requests main ALSO made but could not replay
 // (its own pre-existing replay misses); everything above that needs the new reviewed binding.
 // Also newly bound (PR #316): main could not resolve the target at all (ARCHITECTURE_TARGET_UNRESOLVED) and the branch binds it through an
 // exact immutable-forwarder runtime (canonical EIP-1167 or Solady LibClone 44-byte). Budget, pinning and every field check are unchanged.
 const forwarderBound=b.f.contractArchitecture.reason==='ARCHITECTURE_TARGET_UNRESOLVED'&&!b.f.contractArchitecture.ok&&a.f.contractArchitecture.ok&&
  /^(EIP-1167 minimal proxy|Minimal proxy \(Solady LibClone, 44-byte\))/.test(a.f.contractArchitecture.value||'');
 const newlyBound=forwarderBound||/· delegation proven$/.test(b.f.contractArchitecture.value||'')&&!/· delegation proven$/.test(a.f.contractArchitecture.value||'');
 if(binding>(b.net.replayMiss||0))assert.ok(newlyBound,'Proxy-binding reads spent on a contract that was not newly bound: '+id);
 if(binding){budgets.binding+=binding;budgets.bindingContracts++;}
 assert.ok(restriction<=RESTRICTION_BUDGET,'Transfer-restriction state read budget exceeded for '+id+' ('+restriction+'>'+RESTRICTION_BUDGET+')');
 if(restriction)assert.ok(!b.f.transferRestrictions?.ok,'Restriction reads spent on an already verified restriction row: '+id);
 assert.ok(reviewed<=REVIEWED_BUDGET,'Reviewed-profile read budget exceeded for '+id+' ('+reviewed+'>'+REVIEWED_BUDGET+')');
 assert.ok(customRole<=CUSTOM_ROLE_BUDGET,'Custom AccessControl role read budget exceeded for '+id+' ('+customRole+'>'+CUSTOM_ROLE_BUDGET+')');
 if(reviewed)assert.ok(!b.f.tradingTaxes.ok,'Reviewed-profile reads spent on an already verified tax row: '+id);
 assert.ok(a.net.sourcify-reference-(a.net.augBindingSource||0)-authSource<=b.net.sourcify,'New Sourcify usage for '+id);
 assert.ok(probe<=PROBE_BUDGET,'Proxy delegation probe budget exceeded for '+id+' ('+probe+'>'+PROBE_BUDGET+')');
 assert.ok(siblingCalls<=SIBLING_BUDGET,'Sibling getter budget exceeded for '+id+' ('+siblingCalls+'>'+SIBLING_BUDGET+')');
 assert.ok(reference<=1,'Sibling reference fetched more than once for '+id);
 // Eligibility: no budgeted request for a contract whose relevant field was already verified on main.
 if(probe)assert.ok(!b.f.contractArchitecture.ok,'Delegation probe spent on an already verified architecture: '+id);
 if(siblingCalls||reference)assert.ok(b.chain==='robinhood'&&['tradingTaxes','mintCapability','ownerAdmin'].every(f=>!b.f[f].ok),'Sibling budget spent on an ineligible/verified contract: '+id);
 budgets.restriction+=restriction;if(restriction)budgets.restrictionContracts++;budgets.probe+=probe;budgets.sibling+=siblingCalls;budgets.reference+=reference;budgets.reviewed+=reviewed;budgets.customRole+=customRole;if(reviewed)budgets.reviewedContracts++;if(probe)budgets.probeContracts++;if(siblingCalls)budgets.siblingContracts++;if(customRole)budgets.customRoleContracts++;
 assert.ok(a.net.replayMiss<=b.net.replayMiss,'New unmatched replay request for '+id);
}
for(const category of ['goplus','explorer','other','replayMiss']){
 assert.ok((after.net[category]||0)<=(before.net[category]||0),'Request/replay regression: '+category);
}
assert.ok(after.net.rpc-(after.net.augProbe||0)-(after.net.augSibling||0)-(after.net.augReviewed||0)-(after.net.augCustomRole||0)-(after.net.augRestriction||0)-(after.net.augBinding||0)-(after.net.augAuthority||0)<=before.net.rpc,'Request/replay regression: rpc');
assert.ok(after.net.sourcify-(after.net.augReference||0)-(after.net.augBindingSource||0)-(after.net.augAuthoritySource||0)<=before.net.sourcify,'Request/replay regression: sourcify');
assert.equal(before.net.augProbe||0,0,'BEFORE must not use budgeted requests');assert.equal(before.net.augSibling||0,0);assert.equal(before.net.augReference||0,0);assert.equal(before.net.augReviewed||0,0);assert.equal(before.net.augCustomRole||0,0);assert.equal(before.net.augRestriction||0,0);assert.equal(before.net.augBinding||0,0);assert.equal(before.net.augBindingSource||0,0);
assert.equal(before.net.augAuthority||0,0);assert.equal(before.net.augAuthoritySource||0,0);
const summary={samples:before.rows.length,coverage:stats,customRoleEvidence:{before:customRoleEvidenceBefore,after:customRoleEvidenceAfter,gain:customRoleEvidenceAfter-customRoleEvidenceBefore},budgets,requests:{before:before.net,after:after.net},replayComplete:before.net.replayMiss===0&&after.net.replayMiss===0};
console.log('PAIRED_MECHANICS_GATE PASS '+JSON.stringify(summary));
if(!summary.replayComplete)console.warn('WARNING: missing recorded responses were fail-closed; the replay is not complete. No live fallback was used.');
