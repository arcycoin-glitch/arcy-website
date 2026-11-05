#!/usr/bin/env node
'use strict';
// READ-ONLY Phase B evidence probe 2: ARGUS vs ASTOCK legacy tax evidence; Pons reference masked fingerprint.
process.env.VERCEL='1';delete process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
const path=require('node:path'),crypto=require('node:crypto'),root=process.cwd(),req=p=>require(path.join(root,p));
(async()=>{
 const sf=await (await fetch('https://sourcify.dev/server/v2/contract/4663/0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3?fields=runtimeBytecode',{signal:AbortSignal.timeout(20000)})).json();
 const b=Buffer.from(sf.runtimeBytecode.onchainBytecode.slice(2),'hex');for(const r of Object.values(sf.runtimeBytecode.immutableReferences).flat())b.fill(0,r.start,r.start+r.length);
 console.log('PB2_FP '+JSON.stringify({len:b.length,maskedSha256:crypto.createHash('sha256').update(b).digest('hex'),cbor:sf.runtimeBytecode.cborAuxdata||null,tail:sf.runtimeBytecode.onchainBytecode.slice(-120)}));
 const legacy=req('search/server/lib/arc-legacy-evidence'),adapter=req('search/server/lib/arc-adapter');
 for(let attempt=0;attempt<3;attempt++){try{const raw=await legacy.callOriginal('mechanics','0xece5ca8bf9220718e5727754026757512212cb3c');const cf=raw.contractFields||{};const pk=x=>x&&{value:x.value,status:x.status,dataState:x.dataState,source:x.source,reasonCode:x.reasonCode,unit:x.unit,rawBps:x.rawBps,evidence:(x.evidence||[]).slice(0,4).map(e=>({source:e.source,method:e.method,profile:e.profile,sourceDigest:e.sourceDigest&&e.sourceDigest.slice(0,12),block:e.block}))};
  console.log('PB2_LEGACY '+JSON.stringify({attempt,profile:raw.verifiedSource?.profile||raw.profile||null,buyTax:pk(cf.buyTax),sellTax:pk(cf.sellTax),transferTax:pk(cf.transferTax),mint:pk(cf.mint),keys:Object.keys(cf)}).slice(0,5000));}catch(e){console.log('PB2_LEGACY '+JSON.stringify({attempt,error:String(e.message).slice(0,200)}));}}
 for(const [sym,a] of [['ARGUS','0xece5ca8bf9220718e5727754026757512212cb3c'],['ASTOCK','0x4c9b47dbd5933aa4574b2c27f82419e4dbbd0222']]){
  try{const base=await adapter.inspectToken({address:a});const card=await adapter.inspectCard({base,cardId:'mechanics',address:a});
   const f=card.fields;const pick=x=>x&&{value:x.value,status:x.status,source:x.source,originalStatus:x.originalStatus,verificationStatus:x.verificationStatus,evidence:(x.evidence||[]).slice(0,6).map(e=>({src:e.source,method:typeof e.method==='string'?e.method.slice(0,90):e.method,hookSourceDigest:e.hookSourceDigest||null,runtimeMatch:e.runtimeMatch||null,block:e.block,chainId:e.chainId,address:e.address||e.token||null,scope:typeof e.scope==='string'?e.scope.slice(0,120):null}))};
   console.log('PB2_TAX '+JSON.stringify({sym,tradingTaxes:pick(f.tradingTaxes),mintCapability:pick(f.mintCapability),block:base.block}).slice(0,6000));
  }catch(e){console.log('PB2_TAX '+JSON.stringify({sym,error:String(e.message).slice(0,200)}));}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
