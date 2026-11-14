'use strict';
// The Vercel build of the Search function failed while producer code was reachable from it (bisected on #234: making
// lib/risk-engine/producers/pool.js reachable from api/search was enough). Producers only ever run on the Railway worker,
// so the Search request path must not reference them. This walks the static string-literal require graph (what the
// Vercel file tracer bundles) from every API entrypoint.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..');
function reach(entry){
 const seen=new Set(),stack=[entry];
 while(stack.length){
  const file=stack.pop();if(seen.has(file))continue;seen.add(file);
  const text=fs.readFileSync(file,'utf8');
  for(const m of text.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)){
   const base=path.resolve(path.dirname(file),m[1]);
   for(const c of [base,base+'.js',base+'.cjs',base+'.json',path.join(base,'index.js')])if(fs.existsSync(c)&&fs.statSync(c).isFile()){stack.push(c);break;}
  }
 }
 return [...seen].map(f=>path.relative(ROOT,f));
}
const entries=fs.readdirSync(path.join(ROOT,'api'),{recursive:true}).filter(f=>/\.(c?js)$/.test(f)).map(f=>path.join(ROOT,'api',f));
test('no Vercel API function bundles risk producers, the risk analyzer or the risk worker',()=>{
 assert.ok(entries.length>=5);
 const forbidden=/^lib\/risk-engine\/(producers\/(?!pool-scope\.js)|analyze\.js|worker\.js)/;
 for(const e of entries){const bad=reach(e).filter(f=>forbidden.test(f));assert.deepEqual(bad,[],path.relative(ROOT,e));}
 // The Search function still reaches the request-path shadow module (enqueue + snapshot read).
 assert.ok(reach(path.join(ROOT,'api','search','index.js')).includes('lib/risk-engine/shadow.js'));
});
