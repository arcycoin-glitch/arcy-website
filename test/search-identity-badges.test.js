'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const identity=require('../search/server/lib/token-identity');

const load=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('discovery badge adapter distinguishes indexed candidates from verified issuers without touching locked HTML',()=>{
 const html=load('search/index.html');
 const adapter=load('search/report-navigation.js');
 const home=load('search-upgrade.js');
 // Old detail rendering remains untouched; adapter is loaded by the page.
 assert.match(html,/src="\/search\/report-navigation\.js" defer/);
 assert.match(html,/badge\.textContent=NETWORKS\[item\.network\]\.label\+' · NOT VERIFIED'/);
 assert.match(adapter,/\.detail-match-badge/);
 assert.match(adapter,/\.candidate-badge\.unknown/);
 assert.match(adapter,/\.replace\(\/ · NOT VERIFIED\$\/,\s*' · INDEXED'\)/);
 assert.match(adapter,/badge\.textContent='INDEXED'/);
 assert.match(adapter,/issuer identity unconfirmed/);
 assert.match(home,/status\.textContent='INDEXED'/);
 assert.match(home,/status\.title='Indexed contract candidate; issuer identity has not been independently confirmed\.'/);
 assert.match(home,/status\.textContent='OFFICIAL CONTRACT'/);
 assert.match(home,/status\.textContent='REGISTRY MATCH'/);
});
test('indexed contract is not promoted to issuer-verified by its name, symbol or logo',()=>{
 const token={network:'robinhood',chainId:4663,address:'0x39dbed3a2bd333467115de45665cc57f813c4571',
  name:'Pons',symbol:'PONS',source:'Blockscout explorer index'};
 const rows=identity.rank('robinhood','Pons',[token]);
 const pons=rows.find(row=>row.address===token.address);
 assert.ok(pons);
 assert.equal(pons.identity.status,'NOT_VERIFIED');
 assert.equal(pons.identityVerified,false);
});

test('Argus search prioritizes the actual ARGUS platform token, not an unrelated launchpad token page',()=>{
 const OFFICIAL='0xece5ca8bf9220718e5727754026757512212cb3c';
 const ARCARG='0x7d10b4331a990017938d66542f43fa4a72aacb73';
 assert.equal(identity.verified('arc',ARCARG),null,
  'a creator-issued token on the Argus launchpad is not the Argus platform token');
 const project=identity.verified('arc',OFFICIAL);
 assert.equal(project.status,'OFFICIAL_CONTRACT_MATCHED');
 assert.equal(project.chainId,5042);
 assert.match(project.proofUrl,/gate\.com\/learn\/articles\/what-is-argus/);
 assert.match(project.source,/Gate exchange/,'do not misattribute an exchange record to a first-party issuer');
 assert.equal(identity.verified('ethereum',OFFICIAL),null,'chain-scoped identity cannot leak across networks');
 const marketCandidates=[
  {network:'arc',chainId:5042,address:ARCARG,name:'angel of arc argus',symbol:'ARCARG',source:'Market index'},
  {network:'arc',chainId:5042,address:OFFICIAL,name:'Argus',symbol:'ARGUS',source:'Market index'},
  {network:'arc',chainId:5042,address:'0xe30b6f7923ef2207b2f827013d9bd9874b351bbd',name:'Argus Panoptes',symbol:'ARGUS',source:'Market index'}
 ];
 const ranked=identity.rank('arc','Argus',marketCandidates);
 assert.equal(ranked[0].address,OFFICIAL,'original ARGUS is first');
 assert.equal(ranked[0].identity.status,'OFFICIAL_CONTRACT_MATCHED');
 assert.equal(ranked.find(x=>x.address===ARCARG).identity.status,'NOT_VERIFIED');
 assert.equal(ranked.find(x=>x.address===ARCARG).identityVerified,false);
 assert.equal(ranked.find(x=>x.address===marketCandidates[2].address).identity.status,'NOT_VERIFIED');
 const direct=identity.rank('arc','ARCARG',[marketCandidates[0]]);
 assert.equal(direct[0].identity.status,'NOT_VERIFIED',
  'searching the third-party token by exact ticker must not restore a bogus issuer badge');
 assert.equal(identity.knownMatches('arc','ARGUS')[0].address,OFFICIAL);
});
