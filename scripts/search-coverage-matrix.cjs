'use strict';
// Read-only coverage matrix of the PUBLIC Search API (default https://www.arcyusdc.xyz). Output: GitHub annotations + a table on stdout.
// Denominator = tokens x 5 cards x 4 fields. "filled" = value present and status != NOT_VERIFIED. "strong" = on-chain / market-verified / signed / source+state verified.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',CHAINS=['arc','ethereum','robinhood'],PER=Number(process.env.PER_CHAIN||10);
const STRONG=new Set(['ON_CHAIN','ON_CHAIN_DERIVED','SIGNED_ONCHAIN_SNAPSHOT','MARKET_API_VERIFIED','VERIFIED_SOURCE','VERIFIED_SOURCE_AND_STATE','SOURCE_REPORTED_RPC_RECONCILED']);
const get=async p=>{const r=await fetch(BASE+p,{headers:{accept:'application/json','user-agent':'ARCY-coverage-probe/1.0'},signal:AbortSignal.timeout(30000)});const t=await r.text();try{return JSON.parse(t);}catch{console.log(`::warning::non-JSON from ${p}: HTTP ${r.status} ${t.slice(0,80).replace(/\s+/g,' ')}`);return {};}};
(async()=>{
 const agg={},add=(k,v)=>{const a=agg[k]=agg[k]||{n:0,filled:0,strong:0};a.n++;if(!(v.value===null||v.value===undefined||v.status==='NOT_VERIFIED')){a.filled++;if(STRONG.has(v.status))a.strong++;}};
 for(const chain of CHAINS){
  const rad=await get('/api/search?action=radar&chain='+chain),toks=(rad.tokens||[]).slice(0,PER);
  for(const t of toks){const address=String(t.address||t.token||'').toLowerCase();if(!/^0x[0-9a-f]{40}$/.test(address))continue;
   try{const j=await get(`/api/search?action=report&chain=${chain}&address=${address}`);
    for(const [card,c] of Object.entries(j.cards||{}))for(const [f,v] of Object.entries(c.fields||{})){add('ALL',v);add(chain,v);add(chain+'|'+card,v);add(chain+'|'+card+'.'+f,v);}
   }catch(e){console.log('::warning::report failed '+chain+' '+address+' '+e.message);}
  }
 }
 const pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'n/a';
 for(const [k,a] of Object.entries(agg).sort())console.log(`${k.padEnd(40)} filled ${a.filled}/${a.n} (${pct(a.filled,a.n)})  strong ${a.strong}/${a.n} (${pct(a.strong,a.n)})`);
 const all=agg.ALL||{n:0,filled:0,strong:0};console.log(`::notice::Search coverage ${all.filled}/${all.n} filled (${pct(all.filled,all.n)}), ${all.strong}/${all.n} strong (${pct(all.strong,all.n)})`);
})().catch(e=>{console.log('::warning::matrix failed '+e.message);});
