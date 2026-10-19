'use strict';
// No dependency installation, source permission changes or external writes.
// --real additionally exercises public read-only APIs under caller permissions.
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
const commands=[['--test',...fs.readdirSync(path.join(root,'test')).filter(x=>x.endsWith('.test.js')).map(x=>'test/'+x),...fs.readdirSync(path.join(root,'tests')).filter(x=>x.endsWith('.test.mjs')).map(x=>'tests/'+x)],['test/browser-regression.cjs'],['test/search-browser-e2e.cjs'],['test/search-mechanics-visibility.cjs'],['test/search-progress-browser.cjs']];
if(process.argv.includes('--real'))commands.push(['scripts/search-v5-browser.cjs']);
const results=[];
for(const args of commands){const r=spawnSync(process.execPath,args,{cwd:root,env:process.env,windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});const name=args[0]==='--test'?'node':path.basename(args[0],'.cjs');fs.writeFileSync(path.join(root,'artifacts/v6-acceptance-'+name+'.txt'),(r.stdout||'')+(r.stderr||''));results.push({name,exitCode:r.status,error:r.error?.code||null});console.log(name,r.status===0?'PASS':'FAIL')}
fs.writeFileSync(path.join(root,'artifacts/v6-acceptance-manifest.json'),JSON.stringify(results,null,2));if(results.some(r=>r.exitCode!==0))process.exitCode=1;
