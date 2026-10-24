'use strict';
// Process-local, bounded aggregate diagnostics. Never retain addresses, URLs,
// RPC parameters, exception messages, credentials or arbitrary label values.
const NETWORKS=new Set(['arc','ethereum','robinhood']);
const PROVIDERS=new Map([['api.dexscreener.com','dex'],['eth.blockscout.com','explorer'],['arcexplorer.org','explorer'],['sourcify.dev','source'],['api.geckoterminal.com','market'],['arcscan.app','explorer']]);
const OUTCOMES=new Set(['ok','timeout','rate_limit','forbidden','unavailable','invalid','circuit_open','cache_hit','cache_miss','coalesced','overloaded']);
const entries=new Map();
function provider(url){try{return PROVIDERS.get(new URL(url).hostname)||'other'}catch{return 'other'}}
function category(error){return error?.httpStatus===429?'rate_limit':error?.httpStatus===403?'forbidden':/Timeout|Abort/.test(error?.name||'')||error?.code==='SOURCE_TIMEOUT'?'timeout':error?.code==='SOURCE_SCHEMA_INVALID'?'invalid':'unavailable'}
function record(kind,network,outcome,ms=0,coverage){
 if(!['rpc','source','report'].includes(kind)||!NETWORKS.has(network)&&!['dex','explorer','source','market','other'].includes(network)||!OUTCOMES.has(outcome))return;
 const key=[kind,network,outcome].join(':'),r=entries.get(key)||{kind,network,outcome,count:0,totalMs:0,buckets:[0,0,0,0,0,0],coverageTotal:0};
 r.count++;r.totalMs+=Math.max(0,Math.min(120000,Number(ms)||0));r.buckets[[100,500,1000,2000,6000,Infinity].findIndex(b=>ms<=b)]++;
 if(Number.isInteger(coverage)&&coverage>=0&&coverage<=20)r.coverageTotal+=coverage;
 entries.set(key,r);
}
function snapshot(){return {scope:'Current process only; resets on cold start. Not durable worker health or population statistics.',latencyBucketUpperMs:[100,500,1000,2000,6000,null],entries:[...entries.values()].map(x=>({...x,buckets:[...x.buckets]}))}}
module.exports={provider,category,record,snapshot};
