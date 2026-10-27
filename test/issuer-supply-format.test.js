'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEngine}=require('../search/server/lib/data-engine');
const record={
 kind:'ISSUER_DISCLOSED_WALLET_CURRENT_CUSTODY',
 chainId:1,network:'ethereum',address:'0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',
 wallet:'0x677fd4ed8ae623f2f625deb2d64f2070e46ca1a1',block:'0x1777',
 rawBalance:'1000000000000000000',balance:'1',decimals:18,
 method:'balanceOf(issuer-disclosed custody wallet)',
 sourceUrl:'https://blog.ondo.foundation/ondo-foundation-group-wallet-address-disclosure/'
};
const ONDO=record.address;
async function render({address=ONDO,evidence=record}={}){
 const base={network:'ethereum',chainId:1,address,block:'0x1777',
  token:{name:'Token',symbol:'TEST',decimals:18}};
 const adapter={
  inspectToken:async()=>base,
  inspectCard:async({cardId})=>cardId==='supply'?{
    description:'Pinned supply evidence',fields:{},
    supplementalEvidence:[evidence],
    researchNotes:['Ondo Foundation disclosed a locked-token custody wallet, from the public issuer disclosure.']
  }:{fields:{}}
 };
 return createEngine({ethereum:adapter}).report({network:'ethereum',address});
}
test('supply formatter retains ONLY chain/contract/block-bound official custody proof, independent of four metrics',async()=>{
 const out=await render();
 const card=out.cards.supply;
 assert.equal(card.supplementalEvidence.length,1);
 assert.equal(card.supplementalEvidence[0].sourceUrl,record.sourceUrl);
 assert(card.researchNotes.some(n=>n.startsWith('Ondo Foundation disclosed')));
 assert.deepEqual(Object.keys(card.fields),['totalSupply','circulatingSupply','burnAddressBalance','nextUnlock']);
 assert(card.fields.circulatingSupply.dataState==='NOT_VERIFIED');
 assert(card.fields.nextUnlock.dataState==='NOT_VERIFIED');
 assert.equal(card.status,'NOT_VERIFIED');
});
test('formatter rejects other tokens, networks, stale source blocks or altered evidence address',async()=>{
 const variants=[
  {address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',evidence:record},
  {evidence:{...record,block:'0x1776'}},
  {evidence:{...record,sourceUrl:'https://attacker.invalid/asset'}},
  {evidence:{...record,wallet:'0x'+'1'.repeat(40)}},
  {evidence:{...record,rawBalance:'bogus'}},
  {evidence:{...record,network:'robinhood'}}
 ];
 for(const v of variants){
  const out=await render(v);
  assert(!out.cards.supply.supplementalEvidence,'False custody provenance should be excluded');
  assert(!out.cards.supply.researchNotes.some(n=>n.startsWith('Ondo Foundation disclosed')));
 }
});
