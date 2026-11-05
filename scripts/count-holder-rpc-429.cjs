#!/usr/bin/env node
'use strict';
// Count Holder worker RPC 429 provider responses in exported Railway logs, with one fixed method for every window.
// Usage: node scripts/count-holder-rpc-429.cjs <logs.txt|logs.json> [--from ISO] [--to ISO] [--last N]
// Input: Railway log export (JSON lines with "message"/"timestamp", a JSON array of such objects, or plain text lines).
// Method (identical pre/post):
//   entries         = log entries in the window
//   attempts429     = provider attempts with httpStatus 429 inside HOLDER_RPC_ATTEMPTS events (each attempt counted once)
//   lines429        = entries whose text contains an HTTP 429 marker (httpStatus":429 / HTTP 429 / RATE_LIMITED)
//   batches         = HOLDER_WORKER_BATCH events; slices = results inside them; per-state counts
//   yields          = RPC_COOLDOWN_YIELD + HOLDER_WORKER_BUDGET_EXHAUSTED results
// Rates are reported per 500 entries and per hour so windows of different length compare fairly.
const fs=require('node:fs');
const args=process.argv.slice(2),file=args.find((a,i)=>!a.startsWith('--')&&!(i>0&&args[i-1].startsWith('--')));
const opt=k=>{const i=args.indexOf('--'+k);return i>=0?args[i+1]:null;};
if(!file){console.error('usage: count-holder-rpc-429.cjs <export> [--from ISO] [--to ISO] [--last N]');process.exit(2);}
const raw=fs.readFileSync(file,'utf8');let entries=[];
try{const d=JSON.parse(raw);if(Array.isArray(d))entries=d;}catch{}
if(!entries.length)entries=raw.split(/\r?\n/).filter(Boolean).map(l=>{try{const o=JSON.parse(l);return o&&typeof o==='object'?o:{message:l};}catch{return {message:l};}});
const norm=e=>{const msg=typeof e.message==='string'?e.message:JSON.stringify(e);const ts=Date.parse(e.timestamp||e.time||e.ts||(msg.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/)||[])[0]||'');return {msg,ts:Number.isFinite(ts)?ts:null};};
let rows=entries.map(norm);
const from=opt('from')?Date.parse(opt('from')):null,to=opt('to')?Date.parse(opt('to')):null;
if(from!==null)rows=rows.filter(r=>r.ts!==null&&r.ts>=from);
if(to!==null)rows=rows.filter(r=>r.ts!==null&&r.ts<to);
if(opt('last'))rows=rows.slice(-Number(opt('last')));
const out={entries:rows.length,attempts429:0,lines429:0,rpcAttemptEvents:0,batches:0,slices:0,states:{},yields:0,reasonCodes:{}};
for(const r of rows){
 if(/httpStatus"?\s*:\s*429|HTTP 429|RATE_LIMITED|RPC_RATE_LIMIT/.test(r.msg))out.lines429++;
 let j=null;const m=r.msg.indexOf('{');if(m>=0){try{j=JSON.parse(r.msg.slice(m));}catch{}}
 if(j?.event==='HOLDER_RPC_ATTEMPTS'){out.rpcAttemptEvents++;for(const a of j.attempts||[])if(a?.httpStatus===429||a?.class==='RPC_RATE_LIMIT')out.attempts429++;}
 if(j?.event==='HOLDER_WORKER_BATCH'){out.batches++;for(const x of j.results||[]){out.slices++;out.states[x.state]=(out.states[x.state]||0)+1;if(x.reasonCode)out.reasonCodes[x.reasonCode]=(out.reasonCodes[x.reasonCode]||0)+1;if(['RPC_COOLDOWN_YIELD','HOLDER_WORKER_BUDGET_EXHAUSTED'].includes(x.reasonCode))out.yields++;for(const a of x.rpcAttempts||[])if(a?.httpStatus===429||a?.class==='RPC_RATE_LIMIT')out.attempts429++;}}
}
const ts=rows.map(r=>r.ts).filter(Number.isFinite),hours=ts.length>1?(Math.max(...ts)-Math.min(...ts))/36e5:null;
out.window={from:ts.length?new Date(Math.min(...ts)).toISOString():null,to:ts.length?new Date(Math.max(...ts)).toISOString():null,hours:hours&&Math.round(hours*100)/100};
out.per500={lines429:out.entries?Math.round(out.lines429/out.entries*500):null,attempts429:out.entries?Math.round(out.attempts429/out.entries*500):null};
out.perHour=hours?{lines429:Math.round(out.lines429/hours),attempts429:Math.round(out.attempts429/hours),slices:Math.round(out.slices/hours)}:null;
console.log(JSON.stringify(out,null,1));
