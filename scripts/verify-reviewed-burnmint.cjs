'use strict';
// Offline audit only: no compiler/source downloads or credentials in production.
// Arguments: verified-source.json absolute-solc-module-directory rpc-code.json
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [reference,compiler,runtime]=process.argv.slice(2);
if(!reference||!compiler||!runtime)throw Error('Expected verified-source JSON, solc module directory and eth_getCode JSON');
const d=JSON.parse(fs.readFileSync(reference)),solc=require(path.resolve(compiler));
assert(solc.version().startsWith('0.8.19+commit.7dd6d404'));
assert.equal(d.chainId,'421614');assert.equal(d.address.toLowerCase(),'0xa8c0c11bf64af62cdca6f93d3769b88bdd7cb93d');assert(['match','exact_match'].includes(d.runtimeMatch));
const root='src/v0.8/shared/token/ERC677/BurnMintERC677.sol',sources={};
function add(name){if(sources[name])return;assert(d.sources[name]);sources[name]={content:d.sources[name].content};
 for(const m of sources[name].content.matchAll(/import\s+(?:[\s\S]*?from\s+)?["']([^"']+)["']\s*;/g))add(path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1])));}
add(root);
const settings={...d.compilation.compilerSettings,outputSelection:{[root]:{BurnMintERC677:['evm.deployedBytecode']}}};
const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings})));
assert(!out.errors?.some(e=>e.severity==='error'));
const bytecode=out.contracts[root].BurnMintERC677.evm.deployedBytecode;
assert.deepEqual(Object.values(bytecode.immutableReferences).flat().map(x=>x.start).sort((a,b)=>a-b),[625,1095,2243,2285]);
assert(Object.values(bytecode.immutableReferences).flat().every(x=>x.length===32));
const review=require('../search/server/lib/mechanics-compiled-runtime'),deep=require('../search/server/lib/mechanics-deep');
assert.equal(deep.digest(sources),review.DIGEST);
assert.equal(require('node:crypto').createHash('sha256').update(Buffer.from(bytecode.object,'hex')).digest('hex'),review.HASH);
assert(review.match(JSON.parse(fs.readFileSync(runtime)).result));
console.log(JSON.stringify({pass:true,compiler:solc.version(),sourceFiles:Object.keys(sources).length,sourceDigest:review.DIGEST,normalizedRuntimeSha256:review.HASH}));
