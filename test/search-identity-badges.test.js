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
