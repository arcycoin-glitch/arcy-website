'use strict';
// External Synthra redirect: no swap engine, no wallet, no undocumented URL parameters, no ARCY contract, no Uniswap in the active UI.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const syn=require('../synthra-redirect.js'),src=fs.readFileSync('synthra-redirect.js','utf8');
const read=p=>fs.readFileSync(p,'utf8');

test('destination is the official Synthra app swap page over https, with no query/hash and no token or network parameters',()=>{
 const u=new URL(syn.SWAP_URL);
 assert.equal(u.protocol,'https:');assert.equal(u.hostname,'app.synthra.org');assert.equal(u.pathname,'/swap');
 assert.equal(u.search,'');assert.equal(u.hash,'');assert.equal(u.username,'');assert.equal(u.port,'');
});
test('label and notice text are exactly as specified',()=>{
 assert.equal(syn.LABEL,'Swap on Synthra ↗');assert.equal(syn.TITLE,'External Swap Notice');
 assert.equal(syn.TEXT[0],'You are leaving ARCY SEARCH and entering Synthra, an independent third-party swap platform.');
 assert.equal(syn.TEXT[1],'ARCY SEARCH does not execute swaps, custody user funds, or provide investment advice. You are responsible for your trading decisions and associated market risks.');
 assert.match(syn.TEXT[2],/^Review all fees, permissions, transaction details and Synthra.s terms before proceeding\.$/);
 assert.match(src,/textContent='Cancel'/);assert.match(src,/textContent='Continue to Synthra'/);
});
test('continue opens a new tab with noopener,noreferrer; cancel/ESC/backdrop never open anything',()=>{
 const calls=[];const win={open:(...a)=>{calls.push(a);return null;}};
 syn.openExternal(win);
 assert.deepEqual(calls,[['https://app.synthra.org/swap','_blank','noopener,noreferrer']]);
 // only the continue handler may call openExternal
 const openCalls=src.match(/openExternal\(win\)(?!\{)/g)||[];assert.equal(openCalls.length,1);
 assert.match(src,/m\.go\.addEventListener\('click',\(\)=>\{openExternal\(win\);close\(\);\}\)/);
 assert.match(src,/m\.cancel\.addEventListener\('click',close\)/);assert.match(src,/e\.key==='Escape'/);
});
test('it is a redirect only: no wallet, signing, key, fetch/XHR or trading-API code',()=>{
 for(const bad of [/ethereum\./i,/window\.ethereum/,/eth_requestAccounts/,/personal_sign/,/eth_sign/,/signTypedData/,/privateKey|mnemonic|seed phrase|recovery phrase/i,/\bfetch\(/,/XMLHttpRequest/,/WebSocket/,/localStorage|sessionStorage|cookie/i,/innerHTML/])
  assert.doesNotMatch(src.replace(/\/\/.*$/gm,''),bad,String(bad));
});
test('no ARCY contract, abandoned-launch text or Uniswap reference in the redirect or the legal page',()=>{
 for(const f of ['synthra-redirect.js','legal.html']){
  const t=read(f).replace(/\/\/.*$/gm,'');
  assert.doesNotMatch(t,/0x[0-9a-f]{40}/i,f+' must carry no contract address');
  assert.doesNotMatch(t,/uniswap/i,f);assert.doesNotMatch(t,/\$ARCY|ARCY\/USDC|liquidity pool|launch/i,f);
 }
});
test('no obsolete Uniswap swap/buy redirect exists in the active UI (home, radar, search shell, active scripts)',()=>{
 const ui=['index.html','radar.html','search/index.html','arcy-coin.html','arcy-analiz.html','transparency.html','app.js','unified.js','premium.js','regression-fixes.js','site-refresh.js','v8-premium.js','radar-entry.js','search/market-radar.js'];
 for(const f of ui){if(!fs.existsSync(f))continue;const t=read(f);
  assert.doesNotMatch(t,/app\.uniswap\.org|uniswap\.org\/swap|href="[^"]*uniswap[^"]*"/i,f+' has no Uniswap link');
 }
});
test('the loader is attached without touching protected files and the legal link/page exist',()=>{
 assert.match(read('regression-fixes.js'),/\/synthra-redirect\.js/);
 const legal=read('legal.html');
 assert.match(legal,/<title>Legal &amp; Disclaimer \| ARCY SEARCH<\/title>/);
 for(const must of [/research and informational tools/i,/does not execute trades or swaps/i,/hold or custody user funds/i,/independent third-party platform/i,/own trading decisions and accept the associated market risks/i,/incomplete, delayed or inaccurate/i,/Nothing on this site is investment, financial, legal or tax advice/i,/does not claim to remove every possible legal responsibility/i])
  assert.match(legal,must,String(must));
 assert.doesNotMatch(legal,/eliminate all|no liability|not liable for any/i);
 assert.match(src,/href='\/legal\.html'|a\.href='\/legal\.html'|l\.href='\/legal\.html'/);
});
test('modal is accessible: dialog role, aria-modal, labelled, focus trap, mobile layout rule',()=>{
 for(const m of [/role','dialog'/,/aria-modal','true'/,/aria-labelledby','syn-title'/,/aria-describedby','syn-desc'/,/e\.key==='Tab'/,/@media\(max-width:480px\)/,/min-height:44px/])assert.match(src,m,String(m));
});

test('source-rendered Synthra button replaces duplicate community card before scripts execute',()=>{
 const h=read('index.html'),start=h.indexOf('<section id="buy">'),end=h.indexOf('</section>',start);
 assert.ok(start>=0&&end>start,'#buy section must exist');
 const buy=h.slice(start,end);
 assert.match(buy,/ARCY community illustration/,'original owl image preserved');
 assert.match(buy,/class="syn-cta"/);
 assert.match(buy,/data-synthra-open/);
 assert.match(buy,/href="https:\/\/app\.synthra\.org\/swap"/);
 assert.equal((buy.match(/data-synthra-open/g)||[]).length,1,'exactly one Synthra CTA');
 assert.doesNotMatch(buy,/ARCY COMMUNITY|Build together|FOLLOW ON X|JOIN TELEGRAM/i,'duplicated community panel removed from original HTML');
 assert.match(h,/<style id="synthra-static-layout">/,'purple styling available before JavaScript');
 const footer=h.slice(h.indexOf('<span class="footer-quick-links"'),h.indexOf('</span>',h.indexOf('<span class="footer-quick-links"')));
 assert.match(footer,/href="\/legal\.html"/,'legal link rendered in HTML without JavaScript');
 assert.match(footer,/href="\/transparency\.html"/,'existing footer links retained');
 assert.match(src,/querySelector\('#buy \[data-synthra-open\]'\)/,'bind to existing static CTA');
 assert.match(src,/e\.preventDefault\(\);open\(cta\)/,'click shows existing warning modal');
 assert.doesNotMatch(src,/card\.replaceWith|actions\.appendChild|quick\.appendChild|querySelector\('#buy \.actions'\)/,'no late DOM replacement');
});
