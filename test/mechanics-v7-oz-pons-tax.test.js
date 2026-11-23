'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const deep=require('../search/server/lib/mechanics-deep');
const v4=require('../search/server/lib/mechanics-reviewed-v4');
const TOKEN='0x'+'11'.repeat(20),BLOCK='0x1234',CODE='0x600160005500';
const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
function inspect({digest='f'.repeat(64),runtimeMatch='match',assurance='EXACT_DEPLOYED_BYTECODE_MATCH',network='robinhood',template=null,runtime=CODE,source=true}={}){
 const log=[];
 const rpc=async(method,params)=>{log.push({method,params});assert.equal(params.at(-1),BLOCK);
  if(method==='eth_getCode')return runtime;
  if(method==='eth_getStorageAt')return word(0);
  if(method==='eth_call')return word(0);
  throw Error(method);
 };
 return deep.inspect({network,address:TOKEN,block:BLOCK,rpc,sourceLoader:async()=>source?({
  digest,abi:[],runtimeMatch,sourceAssurance:assurance,sourceProvider:'Sourcify',
  ...(template?{template}:{})
 }):null}).then(result=>({result,log}));
}
const oz=Object.freeze({profile:'OZ_ERC20_TEMPLATE',libraries:['ERC20'],contract:'FixedToken',
 ownerOnlyFunctions:[],roleOnlyFunctions:[],ungatedFunctions:[],unprovenGates:[],
 ownable:false,accessControl:false,mint:'CONSTRUCTOR_ONLY',burnable:false,
 escalation:false,transferUnmodified:true});
const full=r=>r.fields.tradingTaxes;
test('exact on-chain OZ token runtime with SHA-pinned transfer inheritance qualifies as zero TOKEN fees',async()=>{
 const {result,log}=await inspect({template:oz});
 const t=full(result);
 assert.equal(t.status,'VERIFIED_SOURCE_AND_STATE');
 assert.match(t.value,/^Buy 0% · Sell 0% · Transfer 0% · token fees only/);
 const proof=t.evidence[0];assert.equal(proof.directRuntime,true);
 assert.equal(proof.taxProofClass,'REVIEWED_FULL_EXECUTION_NO_TOKEN_DEDUCTION');
 assert.equal(proof.coverage,'TOKEN_TAX_ALL_TRANSFERS');
 assert.equal(proof.tokenTax.externalFees.dex,'NOT_VERIFIED');
 assert.equal(proof.tokenTax.externalFees.hook,'NOT_VERIFIED');
 assert.equal(proof.tokenTax.externalFees.router,'NOT_VERIFIED');
 assert.equal(log.filter(x=>x.method==='eth_call').length,0,'no fee probing RPC needed');
});
test('sibling exact runtime with verified immutable substitutions stays auditable',async()=>{
 const {result}=await inspect({template:oz,runtimeMatch:'SIBLING_REFERENCE_EXACT_MATCH_IMMUTABLES_ONLY',assurance:'SIBLING_RUNTIME_MATCH_IMMUTABLES_ONLY'});
 assert.equal(full(result).status,'VERIFIED_SOURCE_AND_STATE');
 assert.equal(full(result).evidence[0].runtimeMatch,'SIBLING_REFERENCE_EXACT_MATCH_IMMUTABLES_ONLY');
});
test('OZ fallback refuses full directional tax inference for unsafe proof or other networks',async()=>{
 const variants=[
  {template:oz,network:'arc'},
  {template:oz,assurance:'ABI_ONLY'},
  {template:oz,runtimeMatch:'UNREVIEWED'},
  {template:{...oz,libraries:[]}},
  {template:{...oz,transferUnmodified:false}},
 ];
 for(const v of variants){
  const {result}=await inspect(v);
  const t=full(result);
  assert.equal(t.value,'Transfer 0% · DEX/hook fees NOT VERIFIED');
  assert.equal(t.status,'VERIFIED_SOURCE');
  assert.equal(t.evidence[0].coverage,'TOKEN_TRANSFER_ONLY');
 }
 const unbound=await inspect({template:oz,runtime:'0x6000f4'});
 assert.equal(unbound.result.fields.tradingTaxes,undefined,'DELEGATECALL may not inherit simple ERC20 fee claim');
});
test('two exact audited Pons launch token digests prove zero token-level deduction without claiming pool fees',async()=>{
 for(const digest of Object.keys(v4.PROFILES).filter(k=>v4.PROFILES[k]==='FIXED_LAUNCH_RESTRICTIONS')){
  const {result}=await inspect({digest,network:'robinhood'});
  const t=full(result),p=t.evidence[0];
  assert.equal(t.status,'VERIFIED_SOURCE_AND_STATE');
  assert.match(t.value,/^Buy 0% · Sell 0% · Transfer 0% · token fees only/);
  assert.equal(p.coverage,'TOKEN_TAX_ALL_TRANSFERS');
  assert.equal(p.directRuntime,true);
  assert.equal(p.taxProofClass,'REVIEWED_FULL_EXECUTION_NO_TOKEN_DEDUCTION');
  assert.equal(p.tokenTax.launchRestrictions,'MAY_REVERT');
  assert.equal(p.tokenTax.poolFee,'NOT_VERIFIED');
  assert.match(p.scope,/launch/i);
 }
 const {result}=await inspect({digest:Object.keys(v4.PROFILES).find(k=>v4.PROFILES[k]==='FIXED_LAUNCH_RESTRICTIONS'),runtimeMatch:'UNREVIEWED'});
 assert.equal(full(result).status,'VERIFIED_SOURCE');
});
