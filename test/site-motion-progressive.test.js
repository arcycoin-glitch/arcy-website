'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('hero animation starts when visible, not after window load or idle callback',()=>{
 const script=read('hero-video.js');
 assert.match(script,/new IntersectionObserver/);
 assert.match(script,/rootMargin:'160px 0px 160px 0px'/);
 assert.match(script,/video\.src=video\.dataset\.src/);
 assert.doesNotMatch(script,/requestIdleCallback|addEventListener\('load'/);
 assert.match(script,/video\.play\(\)/);
});
test('mobile browsers receive visible fallback and accessible manual playback',()=>{
 const script=read('hero-video.js'),css=read('hero-video.css');
 assert.match(script,/button\.textContent='▶ Animate owl'/);
 assert.match(script,/button\.setAttribute\('aria-label','Play the ARCY owl animation'\)/);
 assert.match(css,/arcy-owl-mobile-presence/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/hero-motion-toggle/);
 assert.match(css,/hero-flight\.video-playing>img\{opacity:0/);
});
test('all section transitions retain reduced-motion support and reveal without hidden layout',()=>{
 const script=read('premium.js'),css=read('premium.css');
 for(const id of ['hero','search','burn','unlocks','pulse','buy'])
  assert.match(script,new RegExp("'"+id+"'"));
 assert.match(script,/IntersectionObserver/);
 assert.match(script,/arcy-section-arrived/);
 assert.match(css,/arcy-section-enter/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.doesNotMatch(css,/visibility:hidden|opacity:0!important/);
});
