'use strict';
// UNI quarterly vesting (UNIVesting): contract-state Next Unlock with adversarial fixtures.
const test=require('node:test'),assert=require('node:assert/strict');
const keccak=require('../lib/keccak');
const O=require('../search/server/lib/onchain-vesting');
const UNI='0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',V='0xca046a83edb78f74ae338bb5a291bf6fdac9e1d2',TL='0x1a9c8182c09f50c8318d769245bea52c32be35bc',RCP='0xaba63748c4b4def4a3319c3a29fe4829029d926f';
const S=s=>keccak(s).slice(0,10),w=a=>'0x'+a.replace(/^0x/,'').padStart(64,'0'),n=x=>'0x'+BigInt(x).toString(16).padStart(64,'0');
const NOW=Date.parse('2026-11-27T16:00:00Z'),E18=10n**18n;
function fake(over={}){
 const st={chainId:1,code:'0x6080',token:UNI,owner:TL,recipient:RCP,quarterly:5000000n*E18,last:1790812800,allowance:20000000n*E18,balance:262000000n*E18,supply:1000000000n*E18,decimals:18,blockTs:1795794635,...over};
 return async(method,params)=>{
  if(method==='eth_chainId')return n(st.chainId);
  if(method==='eth_blockNumber')return '0x17a1e00';
  if(method==='eth_getCode')return st.code;
  if(method==='eth_getBlockByNumber')return {timestamp:'0x'+st.blockTs.toString(16)};
  const {to,data}=params[0];
  const m={[S('UNI()')]:over.tokenRaw||w(st.token),[S('owner()')]:w(st.owner),[S('recipient()')]:w(st.recipient),[S('quarterlyVestingAmount()')]:n(st.quarterly),[S('lastUnlockTimestamp()')]:n(st.last),
   [S('totalSupply()')]:n(st.supply),[S('decimals()')]:n(st.decimals)};
  const sel=data.slice(0,10);
  if(sel===S('allowance(address,address)'))return n(st.allowance);
  if(sel===S('balanceOf(address)'))return n(st.balance);
  void to;return m[sel]??'0x';
 };
}
test('on-chain verified: exact date, amount, percent, categories and provenance',async()=>{
 const r=await O.inspect(UNI,{rpc:fake(),now:NOW});
 assert.equal(r.dataState,'DATA_FOUND');assert.equal(r.status,'ONCHAIN_VERIFIED');assert.equal(r.value,'2027-01-01T00:00:00Z');
 const e=r.evidence[0];assert.equal(e.eventAmount,'5000000');assert.equal(e.percentOfTotalSupply,0.5);assert.equal(e.chainId,1);assert.equal(e.vestingContract,V);assert.equal(e.token,UNI);
 assert.equal(e.owner,TL);assert.equal(e.recipient,RCP);assert.match(e.evidenceType,/ON_CHAIN_CONTRACT_STATE/);assert.match(e.scope,/Not proof the release executed/);
});
test('unregistered token (e.g. ENA) performs no RPC and stays NOT_VERIFIED',async()=>{
 let calls=0;const r=await O.inspect('0x57e114b691db790c35207b2e685d4a43181e6061',{rpc:async()=>{calls++;return '0x';},now:NOW});
 assert.equal(calls,0);assert.equal(r.value,null);assert.equal(r.reasonCode,'NO_ONCHAIN_VESTING_RECORD');
});
for(const [name,over,code] of [
 ['wrong chain id',{chainId:5042},'CHAIN_ID_MISMATCH'],
 ['vesting address without code',{code:'0x'},'VESTING_CONTRACT_HAS_NO_CODE'],
 ['vesting bound to another token',{tokenRaw:w('0x'+'2'.repeat(40))},'VESTING_TOKEN_MISMATCH'],
 ['quarter already claimable (not a future event)',{last:1782864000},'RELEASE_ALREADY_CLAIMABLE'],
 ['allowance revoked',{allowance:0n},'RELEASE_NOT_FUNDED'],
 ['owner balance too small',{balance:1n},'RELEASE_NOT_FUNDED'],
 ['zero quarterly amount',{quarterly:0n},'VESTING_STATE_UNREADABLE'],
 ['anchor on day 31',{last:1769817600},'UNSUPPORTED_CALENDAR_ANCHOR']
]){
 test('rejects: '+name,async()=>{
  const r=await O.inspect(UNI,{rpc:fake(over),now:NOW});
  assert.equal(r.dataState,'NOT_VERIFIED');assert.equal(r.value,null);assert.equal(r.reasonCode,code);
 });
}
test('RPC failure is a lookup failure, never a value',async()=>{
 const r=await O.inspect(UNI,{rpc:async()=>{throw Object.assign(new Error('x'),{code:'ECONNRESET'});},now:NOW});
 assert.equal(r.reasonCode,'LOOKUP_FAILED');assert.equal(r.value,null);
});
test('Search integration: UNI gets ONCHAIN_VERIFIED Next Unlock; other Ethereum tokens unchanged',async()=>{
 const eth=require('../search/server/lib/eth'),orig=eth.rpc;eth.rpc=fake();
 try{
  const S2=require('../search/server/lib/supply-insights');
  const uni=await S2.inspect({network:'ethereum',base:{address:UNI,network:'ethereum',chainId:1}});
  assert.equal(uni.nextUnlock.status,'ONCHAIN_VERIFIED');assert.equal(uni.nextUnlock.value,'2027-01-01T00:00:00Z');assert.equal(uni.nextUnlock.evidence[0].eventAmount,'5000000');
  const ena=await S2.inspect({network:'ethereum',base:{address:'0x57e114b691db790c35207b2e685d4a43181e6061',network:'ethereum',chainId:1}});
  assert.equal(ena.nextUnlock.status,'NOT_VERIFIED');assert.equal(ena.nextUnlock.blocker.category,'NO_REVIEWED_CONTRACT_SCHEDULE');
 }finally{eth.rpc=orig;}
});
