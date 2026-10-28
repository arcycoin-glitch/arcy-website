'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const policy=require('../search/mechanics-policy'),schema=require('../search/schema');
const address='0x'+'1'.repeat(40),context={address,network:'ethereum',chainId:1,block:'0x123'};
const verified=(value,extra={})=>({value,dataState:'DATA_FOUND',status:'VERIFIED_SOURCE',chainId:1,network:'ethereum',source:'Reviewed source',evidence:[{chainId:1,address,block:'0x123',sourceDigest:'a'.repeat(64),...extra}]});
const reported=value=>({value,dataState:'DATA_FOUND',status:'SOURCE_REPORTED',chainId:1,network:'ethereum',source:'GoPlus Security',evidence:[{chainId:1,address,method:'provider report'}]});
const unknown=(reasonCode,dataState='NOT_VERIFIED')=>({value:null,dataState,status:'NOT_VERIFIED',reasonCode,reason:'Evidence unavailable.',evidence:[]});

test('reviewed transfer-only evidence is displayed as scoped, not a complete tax finding',()=>{
 const field=verified('Transfer 0% · DEX/hook fees NOT VERIFIED',{coverage:'TOKEN_TRANSFER_ONLY'});
 let a=policy.assess({fields:{tradingTaxes:field}},context);
 assert.equal(a.visible,true);assert.equal(a.completeRows,0);assert.equal(a.partialCount,1);assert.deepEqual(a.partialRows,[true,false,false,false]);
 for(const mutate of [f=>delete f.evidence[0].coverage,f=>delete f.evidence[0].sourceDigest,f=>f.evidence[0].block='0x124',f=>f.value='Transfer 101% · DEX/hook fees NOT VERIFIED']){
  const copy=structuredClone(field);mutate(copy);a=policy.assess({fields:{tradingTaxes:copy}},context);assert.equal(a.visible,false);
 }
});
test('contract-matched provider observations remain source reported and cannot be counted as verified',()=>{
 const field=reported('GoPlus reports mint capability');let a=policy.assess({fields:{mintCapability:field}},context);
 assert.equal(a.visible,true);assert.equal(a.completeRows,0);assert.equal(a.sourceReportedCount,1);
 for(const mutate of [f=>f.evidence[0].address='0x'+'2'.repeat(40),f=>f.chainId=5042,f=>f.evidence[0].chainId=5042,f=>f.source='']){
  const copy=structuredClone(field);mutate(copy);assert.equal(policy.assess({fields:{mintCapability:copy}},context).visible,false);
 }
});
test('missing states retain distinct presentation when the source supplies a reason',()=>{
 assert.equal(policy.unavailableLabel(unknown('RPC_TIMEOUT','SOURCE_API_FAILED')),'RPC UNAVAILABLE');
 assert.equal(policy.unavailableLabel(unknown('SOURCE_API_FAILED','SOURCE_API_FAILED')),'SOURCE UNAVAILABLE');
 assert.equal(policy.unavailableLabel(unknown('UNSUPPORTED_NETWORK')),'UNSUPPORTED');
 assert.equal(policy.unavailableLabel(unknown('PROVIDER_DISABLED_LICENSE_UNVERIFIED')),'SOURCE DISABLED');
 assert.equal(policy.unavailableLabel(unknown('CIRCULATING_SUPPLY_UNAVAILABLE')),'DATA UNAVAILABLE');
 assert.equal(policy.unavailableLabel(unknown('NO_VERIFIED_NEXT_UNLOCK')),'NOT VERIFIED');
});

// Exercise the real render function with a minimal DOM so the reported count,
// scoped labels, and withheld invalid values are checked together.
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={setProperty(){}};this.classList={add(){},toggle(){}};this._text='';this.className='';}
 set textContent(value){this._text=String(value);this.children=[]}
 get textContent(){return this._text+this.children.map(x=>x.textContent).join('')}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=children;this._text=''}
 querySelectorAll(){return []}
}
function descendants(node){return [node,...node.children.flatMap(descendants)]}
test('report renders scoped/source-reported evidence, withholds invalid fields and counts only displayed evidence',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../search/index.html'),'utf8');
 const start=html.indexOf('function shortReason(field)'),end=html.indexOf('\nrender(null);',start);
 assert(start>=0&&end>start);
 const cards=new Element('div'),count=new Element('span');
 const document={querySelectorAll:()=>[],createElement:tag=>new Element(tag),createTextNode:text=>{const e=new Element('#text');e.textContent=text;return e}};
 const sandbox={document,URL,ARCYMechanicsPolicy:policy,displayDefinitions:schema,$:id=>id==='cards'?cards:count,metricFormat:{display:String,full:String}};
 vm.runInNewContext(html.slice(start,end)+'\nthis.renderReport=render;',sandbox);
 const fields=Object.fromEntries(schema.map(card=>[card.id,{fields:Object.fromEntries(card.fields.map(([key])=>[key,unknown('INSUFFICIENT_EVIDENCE')]))}]));
 fields.supply.fields.totalSupply={value:'100',dataState:'DATA_FOUND',status:'ON_CHAIN',source:'Ethereum RPC',evidence:[{chainId:1,address,block:'0x123'}]};
 fields.supply.fields.circulatingSupply=unknown('SOURCE_API_FAILED','SOURCE_API_FAILED');
 fields.supply.fields.burnAddressBalance=unknown('UNSUPPORTED_NETWORK');
 fields.mechanics.fields.tradingTaxes=verified('Transfer 0% · DEX/hook fees NOT VERIFIED',{coverage:'TOKEN_TRANSFER_ONLY'});
 fields.mechanics.fields.ownerAdmin=reported('GoPlus-reported owner');
 fields.mechanics.fields.mintCapability=verified('Untrusted value');fields.mechanics.fields.mintCapability.evidence[0].address='0x'+'2'.repeat(40);
 fields.mechanics.fields.contractArchitecture=unknown('RPC_TIMEOUT','SOURCE_API_FAILED');
 sandbox.renderReport({...context,cards:fields});
 assert.match(count.textContent,/20 checks · 3 source-backed/);
 const all=descendants(cards),mechanics=all.find(n=>n.dataset.cardId==='mechanics');assert(mechanics);
 const rows=mechanics.children.filter(n=>n.className==='metric');
 assert.equal(rows.length,4);assert.match(rows[0].textContent,/VERIFIED TOKEN TRANSFER ONLY/);
 assert.match(rows[1].textContent,/NOT VERIFIED/);assert(!rows[1].textContent.includes('Untrusted value'));
 assert.match(rows[2].textContent,/SOURCE REPORTED/);assert.match(rows[3].textContent,/RPC UNAVAILABLE/);
 assert.match(mechanics.textContent,/0 VERIFIED · 1 SCOPED · 1 SOURCE REPORTED/);
 const supply=all.find(n=>n.dataset.cardId==='supply');assert.match(supply.textContent,/SOURCE UNAVAILABLE/);assert.match(supply.textContent,/UNSUPPORTED/);
});
