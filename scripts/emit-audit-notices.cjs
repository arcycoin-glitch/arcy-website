#!/usr/bin/env node
'use strict';
// Emits a compact view of an audit JSON as GitHub ::notice annotations (public via the check-runs API).
// usage: node scripts/emit-audit-notices.cjs FILE KIND PREFIX START COUNT
// KIND=audit (mechanics-audit.json from audit-mechanics.cjs) | prod (prod-rows.json from verify-mechanics-production.cjs)
const fs=require('node:fs');
const [file,kind,prefix,start='0',count='999']=process.argv.slice(2);
if(!fs.existsSync(file)){console.log('::notice title='+prefix+'-missing::'+file);process.exit(0);}
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const rows=(Array.isArray(data)?data:data.rows||[]).slice(Number(start),Number(start)+Number(count));
const F=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
const short=r=>{
 if(kind==='prod')return {y:r.symbol,a:r.address?.slice(0,10),sk:r.skipped,h:r.http,f:r.f&&Object.fromEntries(F.map(k=>[k[0],[r.f[k].ds==='DATA_FOUND'?1:0,r.f[k].ui?1:0,r.f[k].rc,(r.f[k].v||'').slice(0,60)]]))};
 return {y:r.symbol,a:r.address?.slice(0,10),b:r.block,err:r.codeError,ui:r.policy?.complete,c:r.code&&Object.fromEntries(F.map(k=>[k[0],[r.code[k]?.ds==='DATA_FOUND'?1:0,r.policy?.rows?.[k]?1:0,r.code[k]?.rc,(r.code[k]?.v||'').slice(0,70)]])),fx:r.facts&&{c:r.facts.clone1167,i:r.facts.impl1967,z:r.facts.zos,b:r.facts.beacon1967,o:r.facts.owner,p:r.facts.paused,s:Object.fromEntries(Object.entries(r.facts.selectors||{}).map(([k,v])=>[k,v.length])),e:r.facts.error}};
};
const per=Number(process.env.ROWS_PER_NOTICE||4);
for(let i=0;i<rows.length;i+=per){
 console.log('::notice title='+prefix+'-'+(Number(start)+i)+'::'+JSON.stringify(rows.slice(i,i+per).map(short)).replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,' '));
}
