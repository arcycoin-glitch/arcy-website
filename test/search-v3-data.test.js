'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
const images=require('../search/server/lib/logo-validation'),value=require('../search/server/lib/valuation'),dex=require('../search/server/lib/dex-market');
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),P='0x'+'c'.repeat(40),url='https://cdn.dexscreener.com/cms/images/v3-test.png';
function png(w=32,h=32){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;const chunk=(s,b)=>{const type=Buffer.from(s),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(b.length);crc.writeUInt32BE(zlib.crc32(Buffer.concat([type,b])));return Buffer.concat([n,type,b,crc]);};return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.alloc(Math.min(8192,h*(1+w*4))))),chunk('IEND',Buffer.alloc(0))]);}
const field=(v,extra={})=>({value:v,dataState:'DATA_FOUND',status:'ON_CHAIN_ORACLE',network:'ethereum',chainId:1,source:'exact source',evidence:[{network:'ethereum',chainId:1,token:A,block:'0x123'}],...extra});
const base={address:A,block:'0x123',token:{decimals:18},totalSupplyRaw:'1000000000000000000000'};
test('FDV is derived only from exact chain/contract price and pinned supply, never circulating',()=>{
 const out=value.normalize(null,field('2.50'),base,'ethereum');assert.equal(out.value,2500);assert.equal(out.kind,'FDV');assert.match(out.evidence[0].scope,/NOT circulating/);
 for(const bad of [field(0),field(-1),field(2,{chainId:5042}),field(2,{evidence:[{token:B,chainId:1,network:'ethereum'}]})])assert.equal(value.normalize(null,bad,base,'ethereum'),null);
 for(const change of [{totalSupplyRaw:'0'},{totalSupplyRaw:'-5'},{token:{decimals:255}},{block:'latest'}])assert.equal(value.normalize(null,field(2),{...base,...change},'ethereum'),null);
});
test('valid cap/FDV stays reported; contradictory cap is replaced with explicitly labelled full supply value',()=>{
 const cap=field(1000,{kind:'MARKET_CAP'}),price=field(2);assert.equal(value.normalize(cap,price,base,'ethereum'),cap);
 const out=value.normalize(field(99999,{kind:'MARKET_CAP'}),price,base,'ethereum');assert.equal(out.value,2000);assert.equal(out.kind,'FDV');assert.equal(out.evidence[0].rejectedReportedMarketCap,99999);
});
test('scientific prices remain finite and do not turn malformed/underflow/NaN into positive prices',()=>{
 assert.equal(dex.finite('1e-12',{positive:true}),1e-12);
 for(const v of ['1e999','NaN','Infinity','0x10','1e-999',true,null])assert.equal(dex.finite(v,{positive:true}),null);
});
test('contradictory duplicated pair identities/quotes are excluded, exact duplicates deduplicate',()=>{
 const p={chainId:'ethereum',pairAddress:P,baseToken:{address:A},quoteToken:{address:B},dexId:'dex',priceUsd:'2',liquidity:{usd:3},volume:{h24:4}};
 assert.equal(dex.validPools([p,p],'ethereum',A).length,1);
 assert.equal(dex.validPools([p,{...p,priceUsd:'99'}],'ethereum',A).length,0);
 assert.equal(dex.validPools([{...p,chainId:'arc'}],'ethereum',A).length,0);
});
test('remote raster validation requires bounded approved HTTPS and actual dimensions/MIME',async()=>{
 let called=0;const fetcher=async(u,o)=>{called++;assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');return new Response(png(),{headers:{'content-type':'image/png'}});};
 const out=await images.validate(url,{fetcher});assert.equal(out.width,32);assert.equal(out.height,32);assert.equal(out.mime,'image/png');
 for(const bad of ['http://cdn.dexscreener.com/cms/images/a.png','https://127.0.0.1/a.png',url+'#x','https://cdn.dexscreener.com/cms/images/a.svg',url+'?redirect=https://evil.test'])assert.equal(await images.validate(bad,{fetcher}),null);
 assert.equal(called,1);
});
test('HTML, SVG, redirects, MIME spoofing, tiny/huge dimensions and oversized bodies stay fallback',async()=>{
 for(const [body,type,headers]of [['<svg onload="alert(1)"/>','image/svg+xml',{}],['<script>bad</script>','image/png',{}],[png(),'text/html',{}],[png(1,1),'image/png',{}],[png(4096,4096),'image/png',{}],[png(),'image/png',{'content-length':String(images.MAX+1)}]])assert.equal(await images.validate(url,{fetcher:async()=>new Response(body,{headers:{'content-type':type,...headers}})}),null);
 assert.equal(await images.validate(url,{fetcher:async()=>new Response(null,{status:302,headers:{location:'https://evil.test/a.png'}})}),null);
});
test('wrong registry basename cannot give another deployment its artwork',async()=>{
 const registry=require('../search/server/lib/robinhood-assets');const raw='https://cdn.robinhood.com/ncw_assets/logos/'+A+'.png';assert.equal(registry.registryLogo(raw,A),raw);assert.equal(registry.registryLogo(raw,B),null);
 let fetched=false;assert.equal(await images.validate(raw,{registry:true,address:B,fetcher:async()=>{fetched=true;}}),null);assert.equal(fetched,false);
});
test('image timeout fails closed and removes no metrics/data',async()=>{
 const out=await images.validate(url,{timeoutMs:10,fetcher:async(_,o)=>new Response(new ReadableStream({start(c){o.signal.addEventListener('abort',()=>c.error(Error('timeout')));}}),{headers:{'content-type':'image/png'}})});assert.equal(out,null);
});
test('all bundled token SVGs are static permitted artwork, never executable or remote documents',()=>{
 for(const name of fs.readdirSync('search/assets/token-icons').filter(x=>x.endsWith('.svg'))){const s=fs.readFileSync('search/assets/token-icons/'+name,'utf8');assert.ok(s.length<100000);assert.match(s,/<svg/);assert.doesNotMatch(s,/<(?:script|foreignObject|iframe|image)\b|\son[a-z]+\s*=|(?:href|src)\s*=|<!DOCTYPE|@import|javascript:/i);}
});
test('case-variant duplicate wallets never fabricate complete holder population',()=>{
 const holders=require('../search/server/lib/holders'),address='0x'+'ab'.repeat(20);assert.equal(holders.calculate([address,address.toUpperCase().replace('0X','0x')],[50n,50n],100n,2,'0x123',A).fields.top20Pct.dataState,'NOT_VERIFIED');
});
test('Robinhood reconciliations remain pinned and limit concurrent RPC calls to four',async()=>{
 const rank=require('../search/server/lib/robinhood-holder-rank');let active=0,max=0;
 const rows=Array.from({length:20},(_,i)=>({address:{hash:'0x'+(i+1).toString(16).padStart(40,'0')},value:'1'}));
 const result=await rank.fetchRank(A,{block:'0x123',totalSupplyRaw:'20',fetcher:async()=>Response.json({items:rows}),rpcCall:async(_,p)=>{assert.equal(p[1],'0x123');active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return '0x'+'1'.padStart(64,'0');}});
 assert.ok(max<=4);assert.equal(result.holderCount.value,20);assert.equal(result.top20Pct.value,100);
});
test('production permission gates stay closed with no operator approval; no new restricted provider',async()=>{
 const v=process.env.VERCEL,flag=process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED;process.env.VERCEL='1';delete process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED;try{let fetched=false;const out=await dex.inspect('ethereum',A,{fetcher:async()=>{fetched=true;throw Error('not allowed');}});assert.equal(out.priceUsd.dataState,'NOT_VERIFIED');assert.equal(fetched,false);}finally{if(v===undefined)delete process.env.VERCEL;else process.env.VERCEL=v;if(flag===undefined)delete process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED;else process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED=flag;}
});
test('PR26 source validation, evidence precedence, profiles and schema remain preserved through V4 extensions',()=>{
 const cp=require('child_process'),p='search/server/lib/mechanics-deep.js',original=cp.execFileSync('git',['show','7c1faf7:'+p]).toString().replace(/\r\n/g,'\n'),current=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
 const sourceGuard=s=>s.slice(s.indexOf('function validateSource('),s.indexOf('async function sourceFor('));assert.equal(sourceGuard(current),sourceGuard(original));
 const precedence=s=>s.slice(s.indexOf('async function enrich('));assert.equal(precedence(current),precedence(original));
 for(const [,hash,name]of original.matchAll(/'([a-f0-9]{64})':'([A-Z_]+)'/g))assert.equal(require('../search/server/lib/mechanics-deep').PROFILES[hash],name);
 assert.equal(fs.readFileSync('search/server/schema.js','utf8').replace(/\r\n/g,'\n'),cp.execFileSync('git',['show','7c1faf7:search/server/schema.js']).toString().replace(/\r\n/g,'\n'));
});
test('signed-negative oracle answers and incomplete rounds cannot become positive reference prices',async()=>{
 const oracle=require('../search/server/lib/oracle-market'),token='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',now=Date.now(),t=Math.floor(now/1000),word=n=>BigInt(n).toString(16).padStart(64,'0');
 for(const [answer,answered]of [[(1n<<256n)-1n,12n],[100000000n,11n]]){const out=await oracle.inspect(token,'0x123',{now,rpcCall:async(method,p)=>method==='eth_getBlockByNumber'?{timestamp:'0x'+t.toString(16)}:p[0].data==='0x313ce567'?'0x'+word(8):'0x'+[12,answer,t-60,t-60,answered].map(word).join('')});assert.equal(out.priceUsd.dataState,'NOT_VERIFIED');}
});
test('ETH RPC body timeout remains active after HTTP headers arrive',async()=>{
 const saved=global.fetch;global.fetch=async(_,o)=>new Response(new ReadableStream({start(c){o.signal.addEventListener('abort',()=>c.error(Error('body aborted')));}}));
 try{await assert.rejects(require('../search/server/lib/eth').rpc('eth_blockNumber',[],{timeoutMs:15}),/aborted/);}finally{global.fetch=saved;}
});
test('image cache expires, invalid payloads never become logos, streamed overflow is rejected',async()=>{
 const saved=global.fetch;let count=0;global.fetch=async()=>{count++;return new Response(png(),{headers:{'content-type':'image/png'}})};const u='https://cdn.dexscreener.com/cms/images/v3-cache-test.png',now=Date.now();
 try{assert.ok(await images.validate(u,{now}));assert.ok(await images.validate(u,{now:now+5}));assert.equal(count,1);assert.ok(await images.validate(u,{now:now+901000}));assert.equal(count,2);}finally{global.fetch=saved;}
 assert.equal(await images.validate(url,{fetcher:async()=>new Response(Buffer.alloc(images.MAX+1),{headers:{'content-type':'image/png'}})}),null);
});
test('approved production-profile DEX reads coalesce and preserve original retrieval timestamp',async()=>{
 const prior={v:process.env.VERCEL,flag:process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED,fetch:global.fetch};process.env.VERCEL='1';process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED='true';let calls=0;global.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,8));return Response.json([{chainId:'ethereum',pairAddress:P,baseToken:{address:A},quoteToken:{address:B},dexId:'dex',priceUsd:'2',liquidity:{usd:3},volume:{h24:4}}]);};
 try{const [a,b]=await Promise.all([dex.inspect('ethereum',A),dex.inspect('ethereum',A)]);assert.equal(calls,1);assert.equal(a.priceUsd.value,2);assert.equal(a.priceUsd.freshness.retrievedAt,b.priceUsd.freshness.retrievedAt);await new Promise(r=>setTimeout(r,15));const c=await dex.inspect('ethereum',A);assert.equal(calls,1);assert.equal(c.priceUsd.freshness.retrievedAt,a.priceUsd.freshness.retrievedAt);assert.ok(c.priceUsd.freshness.ageMs>=15);}finally{global.fetch=prior.fetch;for(const[k,v]of [['VERCEL',prior.v],['DEXSCREENER_PUBLIC_DISPLAY_APPROVED',prior.flag]])if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('approved visual DOM/CSS and unrelated website sections remain identical to production',()=>{
 const cp=require('child_process'),baseline=p=>cp.execFileSync('git',['show','7c1faf7:'+p],{maxBuffer:8*1024*1024}).toString().replace(/\r\n/g,'\n');
 for(const p of ['index.html','premium.css','api/unlocks.js','api/pulse.js','scripts/holder-worker.cjs'])assert.equal(fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n'),baseline(p),p+' must stay unchanged');
 const withoutScripts=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');assert.equal(withoutScripts(fs.readFileSync('search/index.html','utf8').replace(/\r\n/g,'\n')),withoutScripts(baseline('search/index.html')));
});
