'use strict';
// Public, read-only release acceptance. No secret or budget configuration changes.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const paths=['/api/search?action=health','/api/holders?address=0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b','/api/unlocks','/api/pulse'];
(async()=>{let failed=0;for(const p of paths){try{const r=await fetch(BASE+p,{headers:{accept:'application/json',referer:BASE+'/', 'sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(55000)});const text=await r.text();let d;try{d=JSON.parse(text)}catch{throw Error('HTTP '+r.status+' non-JSON '+text.slice(0,120));}const ok=r.ok&&typeof d==='object'&&d!==null;if(!ok)failed++;console.log(JSON.stringify({path:p,http:r.status,ok,status:d.status||null,block:d.block||null,snapshot:d.snapshot||null,success:d.success,audit:d.audit||null}));}catch(e){failed++;console.log(JSON.stringify({path:p,error:e.message}));}}
 for(const chain of ['arc','ethereum','robinhood','pons']){try{const r=await fetch(BASE+'/api/search?action=radar&chain='+chain,{headers:{referer:BASE+'/', 'sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(55000)});const d=await r.json();const shown=Array.isArray(d.tokens)?d.tokens:[];
const fieldCounts={},fieldReasons={};
for(const t of shown)for(const [name,f] of Object.entries(t.fields||{})){const status=f?.status||'UNKNOWN';fieldCounts[name+':'+status]=(fieldCounts[name+':'+status]||0)+1;if(status==='NOT_VERIFIED'){const reason=name+':'+(f.reasonCode||'UNKNOWN');fieldReasons[reason]=(fieldReasons[reason]||0)+1;}}
console.log(JSON.stringify({chain,http:r.status,ok:d.ok,tokens:d.tokens?.length,ledger:d.discovery?.creditLedger,error:d.error,freshness:d.freshness,
 diagnostic:{asOf:d.asOf,channels:d.discovery?.channels,uniqueCandidates:d.discovery?.uniqueCandidates,excludedCounts:d.discovery?.excludedCounts,excluded:(d.excluded||[]).slice(0,30).map(x=>({symbol:x.symbol,reason:x.reason,detail:x.detail,vol:x.volume24hUsd,evidence:x.evidence})),coverage:d.coverage,
 fields:fieldCounts,missingReasons:fieldReasons,rankedSymbols:shown.map(x=>x.symbol)}}));if(!r.ok||!Array.isArray(d.tokens))failed++;}catch(e){failed++;console.log(JSON.stringify({chain,error:e.message}));}}
 process.exitCode=failed?1:0;
})();
