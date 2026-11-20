'use strict';
// Radar snapshot schedule reliability: frequent cron + freshness skip, explicit stale alerts, preview-by-default manual runs.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const F=require('../scripts/radar-snapshot-freshness.cjs');
const NOW=Date.parse('2026-11-21T00:00:00Z'),ago=m=>new Date(NOW-m*60000).toISOString();

test('FR-1: scheduled runs build only when the Production snapshot is due; other events always build',()=>{
 assert.equal(F.decide({generatedAt:ago(30),now:NOW,event:'schedule'}).build,false);
 assert.equal(F.decide({generatedAt:ago(99),now:NOW,event:'schedule'}).build,false);
 assert.equal(F.decide({generatedAt:ago(100),now:NOW,event:'schedule'}).build,true);
 assert.equal(F.decide({generatedAt:ago(5),now:NOW,event:'workflow_dispatch'}).build,true);
 assert.equal(F.decide({generatedAt:ago(5),now:NOW,event:'push'}).build,true);
 assert.equal(F.decide({generatedAt:ago(5),now:NOW,event:'pull_request'}).build,true);
 assert.equal(F.decide({generatedAt:null,now:NOW,event:'schedule'}).build,true,'unreadable snapshot never skips');
});

test('FR-2: staleness is classified explicitly (never silently treated as fresh)',()=>{
 assert.equal(F.decide({generatedAt:ago(60),now:NOW}).level,'FRESH');
 assert.equal(F.decide({generatedAt:ago(180),now:NOW}).level,'STALE');
 assert.equal(F.decide({generatedAt:ago(360),now:NOW}).level,'CRITICAL');
 assert.equal(F.decide({generatedAt:'garbage',now:NOW}).level,'UNKNOWN');
 // the 6 h CRITICAL threshold equals the serving layer's FRESH window
 assert.equal(F.CRITICAL_MIN*60000,require('../lib/radar-v2/v4-snapshot').FRESH_MS);
});

test('FR-3: workflow wiring — frequent off-peak cron, freshness gate, preview-default manual runs, alert job, publish gate kept',()=>{
 const y=fs.readFileSync(path.join(__dirname,'../.github/workflows/radar-v4-snapshot.yml'),'utf8');
 assert.match(y,/cron: '4,19,34,49 \* \* \* \*'/);
 assert.doesNotMatch(y,/cron: '0 /,'never on the top of the hour');
 assert.match(y,/needs: freshness\n\s+if: needs\.freshness\.outputs\.build == 'true'/);
 assert.match(y,/default: preview/);
 assert.match(y,/inputs\.target != 'production'\)\) && 'radar-v4-snapshots-preview' \|\| 'radar-v4-snapshots'/);
 assert.match(y,/S\.publishable\(s,\{commit:process\.env\.GITHUB_SHA\}\)/,'Production publication gate unchanged');
 assert.match(y,/if: env\.DATA_REF == 'radar-v4-snapshots'\n\s+run: \|\n\s+node -e '\n\s+const fs=require\("node:fs"\),S=require/);
 assert.match(y,/alert:\n\s+needs: \[freshness, snapshot\]/);
 assert.match(y,/issues: write/);
 // schedules and pushes still write Production; pull requests never do
 assert.match(y,/github\.event_name == 'pull_request' \|\| \(github\.event_name == 'workflow_dispatch'/);
});
