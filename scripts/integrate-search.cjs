'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),tmp=path.join(root,'.search-import-temporary');
function must(p,msg){if(!p)throw Error(msg)}
function exactly(s,find,replacement){
 const count=s.split(find).length-1;
 must(count===1,'Expected one match ('+count+'): '+find.slice(0,120));
 return s.replace(find,replacement);
}
function write(relative,data){
 const f=path.join(root,relative);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data);
}
function read(relative){return fs.readFileSync(path.join(root,relative),'utf8')}
function copyDir(from,to){
 fs.mkdirSync(to,{recursive:true});
 for(const entry of fs.readdirSync(from,{withFileTypes:true})){
  if(entry.isDirectory())copyDir(path.join(from,entry.name),path.join(to,entry.name));
  else if(entry.isFile())fs.copyFileSync(path.join(from,entry.name),path.join(to,entry.name));
 }
}
function install(){
 must(fs.existsSync(path.join(root,'index.html')),'Expected original ARCY homepage');
 must(!fs.existsSync(tmp),'Source import temp path already exists');
 cp.execFileSync('git',['clone','--depth=1','--single-branch','--branch','feature/three-chain-release-lab-20261011',
  'https://github.com/arcycoin-glitch/arcy-search.git',tmp],{cwd:root,stdio:'inherit',timeout:110000});
 try{
  const from=path.join(tmp,'eth-lab');
  must(fs.existsSync(path.join(from,'lib','multichain-service.js')),'Verified data adapters missing');
  const service=path.join(root,'search','server');
  copyDir(path.join(from,'lib'),path.join(service,'lib'));
  copyDir(path.join(from,'data'),path.join(service,'data'));
  copyDir(path.join(from,'api'),path.join(service,'api'));
  fs.copyFileSync(path.join(from,'schema.js'),path.join(service,'schema.js'));
  for(const f of ['schema.js','format.js','hero-greeting.js'])
   fs.copyFileSync(path.join(from,f),path.join(root,'search',f));
  let search=fs.readFileSync(path.join(from,'index.html'),'utf8');
  for(const [old,changed] of [
   ['/schema.js','/search/schema.js'],['/format.js','/search/format.js'],
   ['/hero-greeting.js','/search/hero-greeting.js'],
   ['/assets/arcy-greeting.mp4','/assets/1000266146.mp4'],
   ["/api/discover?","/api/search?action=discover&"],["/api/report?","/api/search?action=report&"],
   ["/api/chart?","/api/search?action=chart&"],["/api/token?","/api/search?action=token&"],
   ["/token/arc/","/search/token/arc/"],
   ["=>'/token/'+","=>'/search/token/'+"]]){
    // The new frontend does not call /api/token directly; that endpoint remains available for source-backed tools.
    if(old==='/api/token?'&&!search.includes(old))continue;
    must(search.includes(old),'Search source marker missing: '+old);
    search=search.split(old).join(changed);
  }
  const routeOld='/^\\/token\\/(arc|ethereum|robinhood)\\/';
  const routeNew='/^\\/search\\/token\\/(arc|ethereum|robinhood)\\/';
  search=exactly(search,routeOld,routeNew);
  search=exactly(search,"if(push&&location.pathname!=='/')history.pushState({},'','/');",
    "if(push&&location.pathname!=='/search/')history.pushState({},'','/search/');");
  search=search.replaceAll('TOKEN INTELLIGENCE · ISOLATED TEST','TOKEN INTELLIGENCE · READ ONLY')
    .replaceAll('MULTICHAIN LAB · READ ONLY','CONTRACT FIRST · READ ONLY');
  for(const id of ['arcyBurn','tokenUnlocks','arcPulse','arcySwap','arcyResearch'])
   must(!search.includes('id="'+id+'"'),'Search must not clone original home section '+id);
  must(search.includes('id="tokenDetail"'),'Dedicated research view missing');
  write('search/index.html',search);
  write('api/search/index.js', [
   "'use strict';",
   "const handlers=Object.freeze({",
   " discover:require('../../search/server/api/discover'),",
   " report:require('../../search/server/api/report'),",
   " token:require('../../search/server/api/token'),",
   " chart:require('../../search/server/api/chart')",
   "});",
   "module.exports=async function(req,res){",
   " const params=req.query;",
   " if(!params||typeof params!=='object'||Array.isArray(params))return res.status(400).json({ok:false,error:'INVALID_QUERY'});",
   " const {action,...rest}=params;",
   " if(typeof action!=='string'||!Object.hasOwn(handlers,action))return res.status(404).json({ok:false,error:'UNKNOWN_SEARCH_ACTION'});",
   " const child=Object.create(req);Object.defineProperty(child,'query',{value:rest});",
   " return handlers[action](child,res);",
   "};",""
  ].join('\n'));
  let homepage=read('index.html');
  homepage=exactly(homepage,'<link rel="stylesheet" href="/search-contract.css">',
    '<link rel="stylesheet" href="/search-contract.css">\n<link rel="stylesheet" href="/search-upgrade.css">');
  homepage=exactly(homepage,'</body>','<script src="/search-upgrade.js" defer></script>\n</body>');
  must(homepage.includes('id="hero"')&&homepage.includes('id="burn"')&&homepage.includes('id="unlocks"')&&
    homepage.includes('id="pulse"')&&homepage.includes('id="buy"'),
    'Original home sections not retained');
  write('index.html',homepage);
  const dev=read('dev.cjs');
  let modified=exactly(dev,"(name==='activity'?'market':name)+'.js'",
    "(name==='search'?'search/index':name==='activity'?'market':name)+'.js'");
  modified=exactly(modified,"u.pathname==='/'?'index.html':'.'+decodeURIComponent(u.pathname)",
    "u.pathname==='/'?'index.html':u.pathname==='/search/'||u.pathname==='/search'||"+
    "/^\\/search\\/token\\/(?:arc|ethereum|robinhood)\\/0x[0-9a-f]{40}\\/?$/i.test(u.pathname)"+
    "?'search/index.html':'.'+decodeURIComponent(u.pathname)");
  write('dev.cjs',modified);
  const vercel=JSON.parse(read('vercel.json'));
  const rules=[{source:'/search',destination:'/search/index.html'},
   {source:'/search/token/:network/:address',destination:'/search/index.html'}];
  const oldRules=vercel.rewrites||[];
  for(const rule of rules)if(!oldRules.some(x=>x.source===rule.source))oldRules.push(rule);
  vercel.rewrites=oldRules;
  write('vercel.json',JSON.stringify(vercel,null,2)+'\n');
  must(!search.includes("fetch('/api/discover?"),'Old endpoint still referenced');
  must(search.includes('/api/search?action=discover&'),'Combined API endpoint not referenced');
  console.log('Staged isolated three-chain ARCY SEARCH in original repo branch. Source home sections preserved.');
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
install();
