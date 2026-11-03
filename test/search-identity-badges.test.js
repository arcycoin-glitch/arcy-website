'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const identity=require('../search/server/lib/token-identity');

const load=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('search discovery badges distinguish indexed candidates from issuer verification',()=>{
 const html=load('search/index.html');
 const home=load('search-upgrade.js');
 assert.match(html,/badge\.textContent=NETWORKS\[item\.network\]\.label\+' · INDEXED'/);
 assert.doesNotMatch(html,/badge\.textContent=NETWORKS\[item\.network\]\.label\+' · NOT VERIFIED'/);
 assert.match(html,/badge\.title='Indexed contract candidate; issuer identity is not independently confirmed\.'/);
 assert.match(html,/'INDEXED';[\s\S]{0,180}badge\.classList\.add\('unknown'\)/);
 assert.match(home,/status\.textContent='INDEXED'/);
 assert.match(home,/status\.title='Indexed contract candidate; issuer identity has not been independently confirmed\.'/);
 assert.match(html,/badge\.textContent=NETWORKS\[item\.network\]\.label\+' · OFFICIAL CONTRACT'/);
 assert.match(html,/badge\.textContent=NETWORKS\[item\.network\]\.label\+' · REGISTRY MATCH'/);
 assert.match(home,/status\.textContent='OFFICIAL CONTRACT'/);
 assert.match(home,/status\.textContent='REGISTRY MATCH'/);
});
test('indexed contract is never promoted to issuer-verified by its name, symbol or logo',()=>{
 const token={network:'robinhood',chainId:4663,address:'0x39dbed3a2bd333467115de45665cc57f813c4571',
  name:'Pons',symbol:'PONS',source:'Blockscout explorer index'};
 const rows=identity.rank('robinhood','Pons',[token]);
 const pons=rows.find(row=>row.address===token.address);
 assert.ok(pons);
 assert.equal(pons.identity.status,'NOT_VERIFIED');
 assert.equal(pons.identityVerified,false);
});
