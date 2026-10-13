'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const home=fs.readFileSync(path.join(root,'search-upgrade.js'),'utf8');
const detail=fs.readFileSync(path.join(root,'search/index.html'),'utf8');
function artwork(source,begin,end){
 const i=source.indexOf('const VERIFIED_TOKEN_ART=Object.freeze(');
 const j=source.indexOf(end,i);
 assert.ok(i>=0&&j>i,'exact-contract UI artwork catalog present');
 const code=source.slice(i,j).replace(/(^|\n)\s*\/\/[^\n]*/g,'');
 return vm.runInNewContext(code+';issuerArtwork',Object.create(null));
}
const implementations=[
 ['homepage',artwork(home,'const VERIFIED_TOKEN_ART','function addCandidate(')],
 ['detail',artwork(detail,'const VERIFIED_TOKEN_ART','function displayLogo(')]
];
const recognized={status:'OFFICIAL_CONTRACT_MATCHED'};
for(const [surface,logo] of implementations){
 test(surface+': exact issuer contract maps to installed local artwork',()=>{
  assert.equal(logo('arc','0x3600000000000000000000000000000000000000',recognized),'/search/assets/token-icons/usdc.svg');
  assert.equal(logo('ethereum','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',recognized),'/search/assets/token-icons/usdc.svg');
  assert.equal(logo('ethereum','0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',recognized),'https://cdn.ondo.finance/brand/logos/ondo-icon-black_160x160.png','Ondo official brand icon only on issuer-confirmed contract');
 });
 test(surface+': name and ticker alone cannot give copycats original icons',()=>{
  assert.equal(logo('ethereum','0x0000000000000000000000000000000000000001',recognized),null);
  assert.equal(logo('arc','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',recognized),null);
  assert.equal(logo('ethereum','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',{status:'NOT_VERIFIED'}),null);
  assert.equal(logo('ethereum','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',null),null);
 });
 test(surface+': every resolved local logo file exists',()=>{
  const pairs=[
   ['arc','0x3600000000000000000000000000000000000000'],
   ['ethereum','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
   ['ethereum','0xdac17f958d2ee523a2206206994597c13d831ec7'],
   ['ethereum','0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
   ['ethereum','0x514910771af9ca656af840dff83e8264ecf986ca'],
   ['ethereum','0x6b175474e89094c44da98b954eedeac495271d0f'],
   ['ethereum','0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'],
   ['ethereum','0x45804880de22913dafe09f4980848ece6ecbaf78']
  ];
  for(const [network,address] of pairs)assert.ok(fs.existsSync(path.join(root,logo(network,address,recognized))),network+':'+address);
 });
}
test('discovery retains explicit issuer checks and visible symbol fallbacks',()=>{
 assert.match(home,/issuerArtwork\(network,candidate\.address,candidate\.identity\)/);
 assert.match(home,/candidate\.identity\?\.status==='REGISTRY_MATCHED'/);
 assert.match(home,/home-token-placeholder/);
 assert.match(detail,/displayLogo\(item\.logoUrl,network,item\.address,item\.identity\)/);
 assert.match(detail,/displayLogo\(chosenLogo\|\|asset\.logoUrl,network,data\.address,data\.tokenIdentity\)/);
});
