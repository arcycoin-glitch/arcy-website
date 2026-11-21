#!/usr/bin/env node
'use strict';
// Fixed-cohort before/after comparison of two verified-coverage JSON files (scripts/radar-verified-coverage.cjs output).
// Usage: node scripts/coverage-compare.cjs before.json after.json [label]
const fs=require('node:fs'),V=require('../search/server/lib/verified-coverage');
const [bf,af,label='before -> after']=process.argv.slice(2);
const before=JSON.parse(fs.readFileSync(bf,'utf8')),after=JSON.parse(fs.readFileSync(af,'utf8'));
const d=V.compare(before,after);
const row=(k,c)=>'| '+k+' | '+c.before+'/'+c.applicableBefore+' ('+c.beforePct+'%) | '+c.after+'/'+c.applicableAfter+' ('+c.afterPct+'%) | +'+c.gained+' / -'+c.lost+' |';
const head='| Scope | Before verified | After verified | Gained / lost |\n|---|---|---|---|';
let md='## Verified coverage comparison: '+label+'\n\nSame cohort: **'+d.sameCohort+'** · overall '+d.overall.before+'% → '+d.overall.after+'%\n\n'+head+'\n';
for(const [k,c] of Object.entries(d.byChain))md+=row(k,c)+'\n';
md+='\n'+head+'\n';for(const [k,c] of Object.entries(d.byField))md+=row(k,c)+'\n';
md+='\n'+head+'\n';for(const [k,c] of Object.entries(d.byChainField))if(c.gained||c.lost)md+=row(k,c)+'\n';
md+='\nTransitions: `'+JSON.stringify(d.transitions)+'`\n';
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
console.log(md);
console.log('COMPARE '+JSON.stringify({label,overall:d.overall,byChain:Object.fromEntries(Object.entries(d.byChain).map(([k,c])=>[k,c.beforePct+'->'+c.afterPct])),byField:Object.fromEntries(Object.entries(d.byField).map(([k,c])=>[k,c.beforePct+'->'+c.afterPct]))}));
if(!d.sameCohort)process.exitCode=2;
