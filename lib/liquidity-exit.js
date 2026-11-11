'use strict';
// Liquidity & Exit V2 dispatcher: one cheap read (pool.factory()) decides which reviewed model applies.
// The factory answer is only a routing hint — each engine re-verifies identity at its own pinned block
// (factory.getPair / factory.getPool), so a contract that lies about factory() is still refused.
const {chain,rpcUrl}=require('../search/server/lib/chains');
const {addressWord}=require('./liquidity-v2-reserves');
const v2=require('./liquidity-exit-v2'),v3=require('./liquidity-exit-v3');
const {transport,fail}=v2.internals;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
function supported(network){const id=chain(network).id;return {v2:v2.protocols(id).map(p=>p.id),v3:v3.protocols(id).map(p=>p.id)};}
async function analyze(args={}){
 const cfg=chain(args.network);
 if(!ADDRESS.test(args.pool||'')||!ADDRESS.test(args.tokenIn||''))throw fail('INVALID_ADDRESS');
 const two=v2.protocols(cfg.id),three=v3.protocols(cfg.id);
 if(!two.length&&!three.length)throw fail('NO_REVIEWED_PROTOCOL');
 const now=args.now||Date.now;
 const route=transport({url:rpcUrl(cfg.id,args.env||process.env),fetcher:args.fetcher||fetch,timeoutMs:args.timeoutMs||4000,budget:{used:0,max:3},deadlineAt:now()+5000,now,sleep:args.sleep});
 let factory;
 try{factory=addressWord(await route.rpc('eth_call',[{to:args.pool.toLowerCase(),data:v2.SELECTORS.factory},'latest']));}
 catch(e){throw e.code&&e.code!=='CALL_REVERTED'?e:fail('FACTORY_NOT_REVIEWED');}
 const engine=two.some(p=>p.factory===factory)?v2:three.some(p=>p.factory===factory)?v3:null;
 if(!engine)throw fail('FACTORY_NOT_REVIEWED',{observedFactory:factory});
 const result=await engine.analyze(args);
 result.cost.rpcCalls+=route.cost.rpcCalls;result.cost.routingCalls=route.cost.rpcCalls;
 if(!result.model)result.model='UNISWAP_V2_CONSTANT_PRODUCT_EXACT_IN';
 return result;
}
const CACHE_MS=15000,MAX_ENTRIES=200,cache=new Map(),inflight=new Map();
function cached(args,run=analyze,now=Date.now){
 const key=[args.network,String(args.pool).toLowerCase(),String(args.tokenIn).toLowerCase(),(args.amountsIn||[]).join(',')].join('|');
 const hit=cache.get(key);
 if(hit&&hit.expiresAt>now())return Promise.resolve(hit.value);
 if(inflight.has(key))return inflight.get(key);
 const pending=run(args).then(value=>{if(cache.size>=MAX_ENTRIES)cache.delete(cache.keys().next().value);cache.set(key,{value,expiresAt:now()+CACHE_MS});return value;}).finally(()=>inflight.delete(key));
 inflight.set(key,pending);return pending;
}
module.exports={analyze,cached,supported,classifyFailure:v2.classifyFailure,_reset:()=>{cache.clear();inflight.clear();v2._reset();}};
