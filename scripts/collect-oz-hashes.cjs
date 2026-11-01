'use strict';
// Provenance tool (CI/operator): compute SHA-256 of the exact OpenZeppelin library files Mechanics may recognise.
// Source of truth = published npm tarballs of @openzeppelin/contracts. Output is pasted into search/server/lib/oz-library-hashes.js.
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const FILES=['contracts/token/ERC20/ERC20.sol','contracts/token/ERC20/IERC20.sol','contracts/token/ERC20/extensions/IERC20Metadata.sol','contracts/token/ERC20/extensions/ERC20Burnable.sol','contracts/access/Ownable.sol','contracts/utils/Context.sol','contracts/interfaces/draft-IERC6093.sol','contracts/interfaces/IERC6093.sol','contracts/utils/Context.sol'];
const versions=JSON.parse(execFileSync('npm',['view','@openzeppelin/contracts','versions','--json'],{encoding:'utf8'})).filter(v=>/^[45]\.\d+\.\d+$/.test(v));
const out={},tmp=fs.mkdtempSync(path.join(os.tmpdir(),'oz-'));
for(const v of versions){
 try{
  const dir=path.join(tmp,v);fs.mkdirSync(dir);
  execFileSync('npm',['pack','@openzeppelin/contracts@'+v,'--pack-destination',dir],{cwd:dir,stdio:'ignore'});
  const tgz=fs.readdirSync(dir).find(f=>f.endsWith('.tgz'));
  execFileSync('tar',['xzf',tgz,'--strip-components=1'],{cwd:dir});
  for(const f of new Set(FILES)){const p=path.join(dir,f.replace(/^contracts\//,''));if(!fs.existsSync(p))continue;const h=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');((out[f]||={})[h]||=[]).push(v);}
 }catch(e){console.error('skip',v,e.message);}
}
fs.writeFileSync('oz-hashes.json',JSON.stringify(out,null,1));
const esc=x=>x.replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A');
let i=0;for(const [f,m] of Object.entries(out)){const row={f,h:Object.fromEntries(Object.entries(m).map(([h,vs])=>[h,vs[0]+'..'+vs[vs.length-1]+'('+vs.length+')']))};console.log('::notice title=oz-'+(i++)+'::'+esc(JSON.stringify(row)));}
console.log('::notice title=oz-versions::'+versions.length);
