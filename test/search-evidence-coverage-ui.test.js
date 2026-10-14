'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync(require('node:path').join(__dirname,'../search/index.html'),'utf8');

test('Search coverage separates historical snapshots from current evidence without hiding historical values',()=>{
 assert.match(html,/function isHistoricalEvidence\(field\)/);
 assert.match(html,/field\?\.status==='HISTORICAL_ONCHAIN_VERIFIED'\|\|field\?\.freshness\?\.state==='LAST_VERIFIED'/);
 assert.ok(html.includes("historical+' historical ('+sourceBacked+' source-backed)"));
 assert.match(html,/HISTORICAL EVIDENCE ONLY/);
});

test('Search evidence labels Ethereum candidate-ranked concentrations as RPC-checked candidates and displays scope',()=>{
 assert.match(html,/RPC CHECKED · CANDIDATES/);
 assert.match(html,/const limitation=proof\?\.scope\|\|proof\?\.limitation/);
});
