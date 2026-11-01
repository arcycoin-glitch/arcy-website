'use strict';
// Provenance tool (CI/operator): compute SHA-256 of the exact OpenZeppelin library files Mechanics may recognise.
// Source of truth = published npm tarballs of @openzeppelin/contracts. Output is pasted into search/server/lib/oz-library-hashes.js.
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const FILES=['token/ERC20/ERC20.sol','token/ERC20/IERC20.sol','token/ERC20/extensions/IERC20Metadata.sol','token/ERC20/extensions/ERC20Burnable.sol','access/Ownable.sol','utils/Context.sol','interfaces/draft-IERC6093.sol','interfaces/IERC6093.sol',
 // permit / access-control family and the pure helper libraries they import (pinned so that library assembly is never mistaken for token assembly)
 'token/ERC20/extensions/ERC20Permit.sol','token/ERC20/extensions/draft-ERC20Permit.sol','token/ERC20/extensions/IERC20Permit.sol','token/ERC20/extensions/draft-IERC20Permit.sol',
 'utils/cryptography/EIP712.sol','utils/cryptography/draft-EIP712.sol','utils/cryptography/ECDSA.sol','utils/cryptography/MessageHashUtils.sol','utils/Strings.sol','utils/math/Math.sol','utils/math/SignedMath.sol',
 'utils/ShortStrings.sol','utils/StorageSlot.sol','utils/Nonces.sol','utils/Counters.sol','interfaces/IERC5267.sol','access/AccessControl.sol','access/IAccessControl.sol','utils/introspection/ERC165.sol','utils/introspection/IERC165.sol'];
const versions=JSON.parse(execFileSync('npm',['view','@openzeppelin/contracts','versions','--json'],{encoding:'utf8'})).filter(v=>/^[45]\.\d+\.\d+$/.test(v));
const out={},tmp=fs.mkdtempSync(path.join(os.tmpdir(),'oz-'));
for(const v of versions){
 try{
  const dir=path.join(tmp,v);fs.mkdirSync(dir);
  execFileSync('npm',['pack','@openzeppelin/contracts@'+v,'--pack-destination',dir],{cwd:dir,stdio:'ignore'});
  const tgz=fs.readdirSync(dir).find(f=>f.endsWith('.tgz'));
  execFileSync('tar',['xzf',tgz,'--strip-components=1'],{cwd:dir});
  for(const f of new Set(FILES)){const p=path.join(dir,f);if(!fs.existsSync(p))continue;const h=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');((out[f]||={})[h]||=[]).push(v);}
 }catch(e){console.error('skip',v,e.message);}
}
fs.writeFileSync('oz-hashes.json',JSON.stringify(out,null,1));
const esc=x=>x.replace(/%/g,'%25').replace(/\r/g,'').replace(/\n/g,'%0A');
let i=0;for(const [f,m] of Object.entries(out)){const row={f,h:Object.fromEntries(Object.entries(m).map(([h,vs])=>[h,vs[0]+'..'+vs[vs.length-1]+'('+vs.length+')']))};console.log('::notice title=oz-'+(i++)+'::'+esc(JSON.stringify(row)));}
console.log('::notice title=oz-versions::'+versions.length);
