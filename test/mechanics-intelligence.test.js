'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),policy=require('../search/mechanics-policy');
const A='0x'+'1'.repeat(40),context={address:A,network:'ethereum',chainId:1,block:'0x123'};
const fact=value=>({value,dataState:'DATA_FOUND',status:'VERIFIED_SOURCE',chainId:1,network:'ethereum',source:'Reviewed exact source',evidence:[{address:A,chainId:1,block:'0x123',sourceDigest:'a'.repeat(64)}]});
test('active multichain card hides one architecture and reveals two complete rows or all verified taxes',()=>{
 const card={fields:{contractArchitecture:fact('NON-PROXY')}};
 assert.equal(policy.assess(card,context).visible,true);
 card.fields.ownerAdmin=fact('Role authority');assert.equal(policy.assess(card,context).visible,true);
 const taxes={fields:{tradingTaxes:fact('Buy 0% · Sell 2% · Transfer 0%')}};
 assert.equal(policy.assess(taxes,context).visible,true);
 taxes.fields.tradingTaxes.value='Transfer 0% · DEX/hook fees NOT VERIFIED';assert.equal(policy.assess(taxes,context).visible,false);
 for(const value of ['Buy 100.1% · Sell 0% · Transfer 0%','Buy 101% · Sell 0% · Transfer 0%']){taxes.fields.tradingTaxes.value=value;assert.equal(policy.assess(taxes,context).visible,false);}
 assert.equal(policy.assess(null,context).visible,false);
});
test('visibility rejects wrong chain, contract, block and unlabeled historical evidence; provider reports stay separate',()=>{
 for(const mutate of [f=>f.chainId=5042,f=>f.network='arc',f=>f.evidence[0].address='0x'+'2'.repeat(40),f=>f.evidence[0].block='0x124',f=>f.evidence=[],f=>f.freshness={state:'LAST_VERIFIED'}]){
  const f=fact('Buy 0% · Sell 0% · Transfer 0%');mutate(f);assert.equal(policy.assess({fields:{tradingTaxes:f}},context).visible,false);
 }
 const reported=fact('Buy 0% · Sell 0% · Transfer 0%');reported.status='SOURCE_REPORTED';
 const sourceObservation=policy.assess({fields:{tradingTaxes:reported}},context);
 assert.equal(sourceObservation.visible,true);assert.equal(sourceObservation.completeRows,0);assert.equal(sourceObservation.sourceReportedCount,1);
 const f=fact('Buy 0% · Sell 0% · Transfer 0%');f.freshness={state:'LAST_VERIFIED',observedAt:'2026-10-01T00:00:00Z'};f.evidence[0].block='0x1';assert.equal(policy.assess({fields:{tradingTaxes:f}},context).visible,true);
 f.status='UNVERIFIED';assert.equal(policy.assess({fields:{tradingTaxes:f}},context).visible,false);
});
test('proxy candidate storage is not proxy execution or administrative permission',async()=>{
 const m=require('../search/server/lib/mechanics-deep'),B='0x'+'2'.repeat(40),C='0x'+'3'.repeat(40),word=a=>'0x'+a.slice(2).padStart(64,'0');
 const r=await m.inspect({...context,rpc:async(method,p)=>method==='eth_getCode'?(p[0]===A?'0x60006000f400':'0x600000'):method==='eth_getStorageAt'?(p[1]===m.SLOTS.implementation?word(B):p[1]===m.SLOTS.admin?word(C):'0x'+'0'.repeat(64)):'0x'+'0'.repeat(64),sourceLoader:async()=>null});
 assert.equal(r.fields.contractArchitecture,undefined);assert.equal(r.fields.ownerAdmin,undefined);assert.ok(r.details.observations.some(x=>x.method==='Unbound proxy storage candidate'));
});
test('legacy Arc mechanics rejects an explicit foreign network before any provider request',async()=>{
 const handler=require('../api/mechanics');for(const query of [{address:A,chain:'ethereum'},{address:A,chainId:'4663'},{address:A,network:['arc','ethereum']}]){
  const res={setHeader(){},status(n){this.code=n;return this;},json(d){this.body=d;return this;}};await handler({method:'GET',query},res);assert.equal(res.code,400);assert.equal(res.body.reasonCode,'MECHANICS_CHAIN_MISMATCH');
 }
});
test('secondary security negatives cannot become verified absence',()=>{
 const n=require('../lib/contract-summary').normalize;
 const f={value:false,status:'NOT_DETECTED',dataState:'DATA_FOUND',source:'GoPlus',verificationStatus:'MARKET_API_VERIFIED',evidence:[{source:'GoPlus'}]};
 assert.equal(n(f).value,null);assert.equal(n(f).reasonCode,'SECONDARY_ABSENCE_NOT_PROVEN');
 assert.equal(n({...f,source:'Reviewed runtime',verificationStatus:undefined}).value,false);
 const tax=n({...f,value:0,status:'MARKET_API_VERIFIED'});assert.equal(tax.status,'SOURCE_REPORTED');
 const view=require('../ui-model').summarize('mechanics',{ok:true,contractFields:{buyTax:tax,sellTax:tax,transferTax:tax}});
 assert.equal(view.fields[0].verifiedPresentation,false);assert.match(view.fields[0].text,/SOURCE REPORTED/);assert.equal(require('../ui-model').mechanicsVisibility(view),false);
});
test('legacy proxy storage values remain evidence values, never the subject token identity',()=>{
 const summary=require('../lib/contract-summary'),proof=[{name:'implementation',address:'0x'+'0'.repeat(40),block:'0x123'}];
 const result={block:'0x123',proxy:{value:'0x'+'2'.repeat(40),dataState:'DATA_FOUND',status:'DETECTED',evidence:proof}};
 const x=summary.present(result,{...context,chainId:5042});
 assert.equal(x.contractFields.proxyUpgradeable.evidence[0].address,A);assert.equal(x.contractFields.proxyUpgradeable.evidence[1].address,'0x'+'0'.repeat(40));
 const wrong=summary.present(result,{...context,chainId:1});assert.equal(wrong.contractFields.proxyUpgradeable.evidence[0].address,'0x'+'0'.repeat(40));
});
test('reviewed FiatToken authority roles survive zero ownership; unrelated ABI role names do not establish control',()=>{
 const s=require('../lib/contract-summary'),c=require('../lib/core'),role=c.fact('0x'+'2'.repeat(40),[{method:'masterMinter()',sourceDigest:'reviewed',block:'0x123'}],'GETTER_REPORTED');
 const r={owner:c.fact(c.BURNS[0],[]),admin:c.unknown(),verifiedSource:{profile:{id:'FIAT_TOKEN_V2_2'}},roles:{masterMinter:role}};
 assert.equal(s.present(r).contractFields.ownerAdmin.value,true);
 assert.match(s.present(r).contractFields.ownerAdmin.scope,/surviving roles/);
 r.verifiedSource.profile.id='UNREVIEWED';assert.equal(s.present(r).contractFields.ownerAdmin.value,null);
});
