#!/usr/bin/env node
'use strict';
// Read-only reviewer aid: prints comment-stripped Sourcify source files (chunked to fit CI annotation limits) for a digest-pinned review.
// usage: node scripts/probe-mechanics-v9-source.cjs chainId address filePathRegex part  (part = chunk window of 10 annotations)
const crypto=require('node:crypto');
const [chainId,address,rx,partArg]=process.argv.slice(2),part=Number(partArg||0),CH=3600;
const esc=x=>x.replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A');
const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').map(l=>l.replace(/\/\/.*$/,'').replace(/\s+$/,'')).filter(l=>l.trim()).join('\n');
(async()=>{
 const r=await fetch('https://sourcify.dev/server/v2/contract/'+chainId+'/'+address+'?fields=sources,compilation,abi,runtimeBytecode',{signal:AbortSignal.timeout(25000)});
 const j=await r.json();const src=j.sources||{};
 const digest=crypto.createHash('sha256').update(JSON.stringify(Object.entries(src).map(([p,x])=>[p,x.content]).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
 let text='';
 for(const [k,v] of Object.entries(src).sort(([a],[b])=>a.localeCompare(b))){if(new RegExp(rx,'i').test(k))text+='\n//// '+k+' sha256='+crypto.createHash('sha256').update(v.content).digest('hex').slice(0,16)+'\n'+strip(v.content);}
 if(part===-2){console.log('::notice title=v9-raw::'+esc(JSON.stringify({status:r.status,keys:Object.keys(j),language:j.compilation?.language,compiler:j.compilation?.compilerVersion,name:j.compilation?.name,fullyQualifiedName:j.compilation?.fullyQualifiedName,abiType:Array.isArray(j.abi)?'array:'+j.abi.length:typeof j.abi,files:Object.entries(src).map(([k,v])=>[k,v.content.length]),settings:j.compilation?.compilerSettings?Object.keys(j.compilation.compilerSettings):null,runtimeMatch:j.runtimeMatch,match:j.match,sig:j.signatures?Object.keys(j.signatures).length:null})));return;}
 if(part<0){console.log('::notice title=v9-list::'+esc(JSON.stringify(Object.entries(src).map(([k,v])=>[k.split('/').slice(-3).join('/'),crypto.createHash('sha256').update(v.content).digest('hex').slice(0,10)]).sort())));return;}
 if(part===0)console.log('::notice title=v9-digest::'+esc(JSON.stringify({address,digest,name:j.compilation?.name,compiler:j.compilation?.compilerVersion,files:Object.keys(src).length,matchedChars:text.length})));
 const chunks=[];for(let i=0;i<text.length;i+=CH)chunks.push(text.slice(i,i+CH));
 chunks.slice(part*9,part*9+9).forEach((c,i)=>console.log('::notice title=v9-src-'+address.slice(2,8)+'-'+(part*9+i)+'::'+esc(c)));
})().catch(e=>{console.error(e);process.exitCode=1;});
