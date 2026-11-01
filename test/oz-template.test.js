'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {analyze,strip}=require('../search/server/lib/oz-template');
const sha=t=>crypto.createHash('sha256').update(t).digest('hex');
// Synthetic stand-ins for the pinned library files; real pins live in oz-library-hashes.js.
const L={ERC20:'// SPDX\ncontract ERC20 is Context, IERC20 { }',IERC20:'interface IERC20 {}',Ownable:'abstract contract Ownable is Context { modifier onlyOwner(){_;} function owner() public view returns(address){} }',Context:'abstract contract Context {}',ERC20Burnable:'abstract contract ERC20Burnable is Context, ERC20 { function burn(uint256 a) public {} }',AccessControl:'abstract contract AccessControl is Context { modifier onlyRole(bytes32 r){_;} }',ERC20Permit:'abstract contract ERC20Permit is ERC20 { }',ECDSA:'library ECDSA { function tryRecover(bytes32 h) internal pure { assembly { } } }'};
const lib=Object.fromEntries(Object.entries(L).map(([k,v])=>[sha(v),k]));
const src=(own,extra={})=>({...Object.fromEntries(Object.entries(L).map(([k,v])=>[k+'.sol',{content:v}])),...Object.fromEntries(Object.entries(own).map(([k,v])=>[k,{content:v}])),...extra});
const run=(code,main)=>analyze(src({'T.sol':code}),{lib,main});

test('plain OZ token with constructor-only mint: unmodified transfer, constructor-only mint, no owner-gated functions',()=>{
 const r=run('import "./ERC20.sol";\ncontract T is ERC20 { constructor() ERC20("A","B"){ _mint(msg.sender, 1e24); } }','T');
 assert.equal(r.profile,'OZ_ERC20_TEMPLATE');assert.equal(r.mint,'CONSTRUCTOR_ONLY');assert.equal(r.transferUnmodified,true);assert.deepEqual(r.ungatedFunctions,[]);assert.equal(r.ownable,false);
});
test('onlyOwner mint function is reported as owner-gated, with exact function names',()=>{
 const r=run('contract T is ERC20, Ownable { constructor() ERC20("A","B") Ownable(msg.sender) {} function mint(address to,uint256 a) external onlyOwner { _mint(to,a); } }','T');
 assert.equal(r.mint,'OWNER_GATED');assert.deepEqual(r.ownerOnlyFunctions,['mint']);assert.equal(r.ownable,true);
});
test('mint in an ungated or internal-helper function is UNRESOLVED, never "none" and never "gated"',()=>{
 assert.equal(run('contract T is ERC20 { function mint(address to,uint256 a) external { _mint(to,a); } }','T').mint,'UNRESOLVED');
 assert.equal(run('contract T is ERC20, Ownable { constructor(){ _init(); } function _init() internal { _mint(msg.sender,1); } }','T').mint,'UNRESOLVED');
 assert.equal(run('contract T is ERC20 { function mint(address to,uint256 a) external onlyOwner { _mint(to,a); } }','T').mint,'UNRESOLVED','onlyOwner without inheriting Ownable proves nothing');
});
test('anything that can alter the transfer path or bypass the library yields NO claim (null)',()=>{
 for(const body of [
  'contract T is ERC20 { function _update(address a,address b,uint256 v) internal override { super._update(a,b,v-v/10); } }',
  'contract T is ERC20 { function _transfer(address a,address b,uint256 v) internal override {} }',
  'contract T is ERC20 { function transfer(address a,uint256 v) public override returns(bool){return true;} }',
  'contract T is ERC20 { function _beforeTokenTransfer(address a,address b,uint256 v) internal override {} }',
  'contract T is ERC20 { function f() external { assembly { sstore(0,1) } } }',
  'contract T is ERC20 { function f(address x) external { x.delegatecall(""); } }',
  'contract T is ERC20 { function f() external { selfdestruct(payable(msg.sender)); } }',
  'contract T is ERC20 { function totalSupply() public view override returns(uint256){return 1;} }',
  'contract T is ERC20 { function f() external { _update(address(0),msg.sender,1); } }',
  'contract ERC20 { }\ncontract T is ERC20 { }',                       // shadowed library name
  'contract T is ERC20, Ownable { modifier onlyOwner(){_;} function m() external onlyOwner {} }',
  'contract T is ERC20, Ownable { function owner() public view override returns(address){return address(1);} }',
  'contract T { }'                                                     // never reaches pinned ERC20
 ])assert.equal(run(body,'T'),null,body);
});
test('an unpinned or modified library file disables the analysis; comments and strings cannot hide or fake code',()=>{
 const modified=src({'T.sol':'contract T is ERC20 { constructor(){ _mint(msg.sender,1); } }'});modified['ERC20.sol'].content+=' ';
 assert.equal(analyze(modified,{lib,main:'T'}),null);
 const noLib={'T.sol':{content:'contract T is ERC20 {}'}};assert.equal(analyze(noLib,{lib,main:'T'}),null);
 // banned token inside a comment/string is not code; real one after it still counts
 assert.ok(run('contract T is ERC20 { /* assembly */ string s="delegatecall"; }','T'));
 assert.equal(run('contract T is ERC20 { // selfdestruct\n function f() external { selfdestruct(payable(msg.sender)); } }','T'),null);
 assert.equal(strip('x "a//b" /* c */ y').replace(/\s+/g,' '),'x "" y');
});
test('ungated and custom-gated external functions are listed so ownership absence is never over-claimed',()=>{
 const r=run('contract T is ERC20, Ownable { function setX(uint256 v) external { } function y() external onlyOperator { } function z() external onlyOwner { } }','T');
 assert.deepEqual(r.ungatedFunctions,['setX','y']);assert.deepEqual(r.ownerOnlyFunctions,['z']);assert.deepEqual(r.unprovenGates,['y']);
});
test('burnable library is recognised as a capability only',()=>{
 const r=run('contract T is ERC20Burnable { constructor(){ _mint(msg.sender,1); } }','T');
 assert.equal(r.burnable,true);assert.ok(r.libraries.includes('ERC20Burnable'));
});

// ---- integration with the Mechanics pipeline (pinned-block RPC fixture, injected source) ----
const m=require('../search/server/lib/mechanics-deep');
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),block='0x1234',basic='0x600160005500';
const zero='0x'+'0'.repeat(64),addr=a=>'0x'+a.slice(2).padStart(64,'0');
function fx(template,{owner=zero}={}){
 const rpc=async(method,p)=>{assert.equal(p[p.length-1],block);
  if(method==='eth_getCode')return p[0]===A?basic:'0x';if(method==='eth_getStorageAt')return zero;
  if(method==='eth_call')return p[0].data===m.selector('owner()')?owner:zero;throw Error('Unexpected '+method);};
 const source={digest:'f'.repeat(64),abi:[],url:'https://sourcify.dev/x',template};
 return {network:'ethereum',address:A,block,rpc,sourceLoader:async()=>source};
}
const T=o=>({profile:'OZ_ERC20_TEMPLATE',libraries:['ERC20'],contract:'T',ownable:false,burnable:false,transferUnmodified:true,mint:'CONSTRUCTOR_ONLY',ownerOnlyFunctions:[],ungatedFunctions:[],unprovenGates:[],...o});

test('pipeline: template source yields token-transfer-only tax, no-mint and no-owner facts with explicit scope',async()=>{
 const r=await m.inspect(fx(T({})));
 assert.equal(r.fields.tradingTaxes.value,'Transfer 0% · DEX/hook fees NOT VERIFIED');assert.equal(r.fields.tradingTaxes.status,'VERIFIED_SOURCE');
 assert.equal(r.fields.tradingTaxes.evidence[0].coverage,'TOKEN_TRANSFER_ONLY');assert.match(r.fields.tradingTaxes.evidence[0].scope,/Pool, router and hook fees are separate/);
 assert.equal(r.fields.mintCapability.value,'NONE DETECTED ✓');assert.equal(r.fields.ownerAdmin.value,'No token owner/admin');
});
test('pipeline: non-owner external functions block the "no owner/admin" claim; unproven gates too',async()=>{
 assert.equal((await m.inspect(fx(T({ungatedFunctions:['setX']})))).fields.ownerAdmin,undefined);
 assert.equal((await m.inspect(fx(T({unprovenGates:['y'],ungatedFunctions:['y']})))).fields.ownerAdmin,undefined);
});
test('pipeline: owner-gated mint reads owner() at the pinned block; zero owner is renounced, nonzero is reported, unreadable claims nothing',async()=>{
 const t=T({ownable:true,mint:'OWNER_GATED',ownerOnlyFunctions:['mint']});
 const live=await m.inspect(fx(t,{owner:addr(B)}));
 assert.equal(live.fields.mintCapability.value,'Owner-authorized mint');assert.equal(live.fields.mintCapability.status,'VERIFIED_SOURCE_AND_STATE');assert.match(live.fields.ownerAdmin.value,/Owner-governed \(mint\) · 0x2222/);
 const dead=await m.inspect(fx(t,{owner:zero}));
 assert.match(dead.fields.mintCapability.value,/NONE ACTIVE/);assert.match(dead.fields.ownerAdmin.value,/Ownership renounced/);
 const none=await m.inspect({...fx(t),rpc:async(method,p)=>{if(method==='eth_call'&&p[0].data===m.selector('owner()'))throw Error('revert');return fx(t).rpc(method,p);}});
 assert.equal(none.fields.mintCapability,undefined);assert.equal(none.fields.ownerAdmin,undefined);
});
test('pipeline: UNRESOLVED mint and sources without a template make no tax/mint claim',async()=>{
 assert.equal((await m.inspect(fx(T({mint:'UNRESOLVED'})))).fields.mintCapability,undefined);
 const x=fx(null);const r=await m.inspect(x);assert.equal(r.fields.tradingTaxes,undefined);
});
test('pipeline: reviewed digest profiles keep priority over the generic template',async()=>{
 const digest=Object.keys(m.PROFILES).find(k=>m.PROFILES[k]==='FIXED_SUPPLY_BURNABLE_LAUNCH'),x=fx(T({}));
 x.sourceLoader=async()=>({digest,abi:[],url:'u',template:T({})});
 const r=await m.inspect(x);assert.equal(r.details.reviewedProfile,'FIXED_SUPPLY_BURNABLE_LAUNCH');
});

const LABELS=require('../search/server/lib/oz-template').LIB_CONTRACTS.concat(['IERC6093']);
test('pinned OpenZeppelin hash table: only known library names, 64-hex digests, ERC20 pinned for every 4.x/5.x release line',()=>{
 const h=require('../search/server/lib/oz-library-hashes');
 assert.ok(Object.isFrozen(h));
 for(const [k,v] of Object.entries(h)){assert.match(k,/^[0-9a-f]{64}$/);assert.ok(LABELS.includes(v));}
 assert.ok(Object.values(h).filter(v=>v==='ERC20').length>=15);
});

test('pipeline: ABI-matched zero owner() is a diagnostic observation only and never the displayed owner/admin fact',async()=>{
 const owner={type:'function',name:'owner',stateMutability:'view',inputs:[],outputs:[{type:'address'}]};
 const x=fx(null);x.sourceLoader=async()=>({digest:'e'.repeat(64),abi:[owner],url:'https://sourcify.dev/x'});
 const r=await m.inspect(x);
 assert.equal(r.fields.ownerAdmin,undefined);
 const obs=r.details.observations.find(o=>o.zero);assert.equal(obs.value,'zero address');assert.match(obs.scope,/Not an absence-of-control proof/);
 const y=fx(null);y.sourceLoader=async()=>({digest:'e'.repeat(64),abi:[],url:'u'});assert.ok(!(await m.inspect(y)).details.observations.some(o=>o.zero));
});

test('diagnose explains rejections without ever producing evidence',()=>{
 const {diagnose}=require('../search/server/lib/oz-template');
 assert.equal(diagnose(src({'T.sol':'contract T is ERC20 { function _update(address a,address b,uint256 v) internal override {} }'}),{lib,main:'T'}).reason,'OVERRIDES__update');
 assert.equal(diagnose(src({'T.sol':'contract T is ERC20 { function f() external { assembly {} } }'}),{lib,main:'T'}).reason,'BANNED_ASSEMBLY');
 assert.equal(diagnose({'T.sol':{content:'contract T is ERC20 {}'}},{lib,main:'T'}).reason,'ERC20_NOT_PINNED');
 assert.equal(diagnose(src({'T.sol':'contract T is ERC20, Weird {}'}),{lib,main:'T'}).reason,'UNPINNED_BASE');
 assert.equal(diagnose(src({'T.sol':'contract T is ERC20 { constructor(){ _mint(msg.sender,1); } }'}),{lib,main:'T'}).ok,true);
});

test('ownership/role escalation through an UNGATED function defeats every gate-based conclusion',()=>{
 const own=run('contract T is ERC20, Ownable { function take() external { _transferOwnership(msg.sender); } function mint(address to,uint256 a) external onlyOwner { _mint(to,a); } }','T');
 assert.equal(own.escalation,true);assert.equal(own.mint,'UNRESOLVED');
 const rol=run('contract T is ERC20, AccessControl { bytes32 public constant MINTER_ROLE=keccak256("M"); function join() external { _grantRole(MINTER_ROLE,msg.sender); } function mint(address to,uint256 a) external onlyRole(MINTER_ROLE) { _mint(to,a); } }','T');
 assert.equal(rol.escalation,true);assert.equal(rol.mint,'UNRESOLVED');
 // gated escalation is fine (only the owner can transfer ownership)
 const ok=run('contract T is ERC20, Ownable { function hand(address n) external onlyOwner { _transferOwnership(n); } function mint(address to,uint256 a) external onlyOwner { _mint(to,a); } }','T');
 assert.equal(ok.escalation,false);assert.equal(ok.mint,'OWNER_GATED');
});
test('role-gated mint (OpenZeppelin AccessControl) is recognised; pinned helper libraries may use assembly, own code may not',async()=>{
 const r=run('contract T is ERC20, AccessControl { bytes32 public constant MINTER_ROLE=keccak256("M"); constructor(){ _grantRole(DEFAULT_ADMIN_ROLE,msg.sender); } function mint(address to,uint256 a) external onlyRole(MINTER_ROLE) { _mint(to,a); } }','T');
 assert.equal(r.mint,'ROLE_GATED');assert.deepEqual(r.roleOnlyFunctions,['mint']);assert.equal(r.accessControl,true);
 // pinned library with assembly is accepted (its hash is in the table); the same text in an own file is rejected
 const withLib=src({'T.sol':'contract T is ERC20 { constructor(){ _mint(msg.sender,1); } }'});assert.ok(analyze(withLib,{lib,main:'T'}));
 assert.equal(run('library ECDSA2 { function f() internal pure { assembly {} } }\ncontract T is ERC20 {}','T'),null);
 const tok=await m.inspect(fx(T({mint:'ROLE_GATED',accessControl:true,roleOnlyFunctions:['mint']})));
 assert.equal(tok.fields.mintCapability.value,'Role-gated mint');assert.equal(tok.fields.mintCapability.status,'VERIFIED_SOURCE');assert.match(tok.fields.mintCapability.evidence[0].scope,/not enumerated/);
 assert.equal(tok.fields.ownerAdmin,undefined);
 const esc=await m.inspect(fx(T({ownable:true,mint:'OWNER_GATED',escalation:true,ownerOnlyFunctions:['mint']}),{owner:addr(B)}));
 assert.equal(esc.fields.mintCapability,undefined);assert.equal(esc.fields.ownerAdmin,undefined);
});

test('ownership overrides are allowed only while no UNGATED path can change ownership; permit extension inherits the pinned ERC20',()=>{
 assert.equal(run('contract T is ERC20, Ownable { function renounceOwnership() public override onlyOwner { revert(); } function mint(address a,uint256 v) external onlyOwner { _mint(a,v); } }','T').mint,'OWNER_GATED');
 assert.equal(run('contract T is ERC20, Ownable { function transferOwnership(address n) public override { super.transferOwnership(n); } function mint(address a,uint256 v) external onlyOwner { _mint(a,v); } }','T').mint,'UNRESOLVED');
 assert.equal(run('contract T is ERC20Permit, Ownable { constructor(){ _mint(msg.sender,1); } }','T').mint,'CONSTRUCTOR_ONLY');
});

test('Ownable2Step (pinned) counts as Ownable; its own _transferOwnership override is library code, not token code',()=>{
 const r=run('contract T is ERC20, Ownable2Step { constructor(){ _mint(msg.sender,1); } function mint(address a,uint256 v) external onlyOwner { _mint(a,v); } }','T');
 assert.equal(r.ownable,true);assert.equal(r.mint,'OWNER_GATED','initial constructor mint plus later owner-gated mint is owner-gated, never "none"');
});
