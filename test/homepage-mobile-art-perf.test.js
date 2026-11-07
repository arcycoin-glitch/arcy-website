'use strict';
// The protected homepage image exception must remain narrow and pixel-identical; fail closed on source drift.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const blobSha=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
test('mobile LCP: original community WebP remains byte-identical and deferred below fold',()=>{
 const art=fs.readFileSync(path.join(root,'assets/arcy-community-illustration.webp'));
 assert.equal(blobSha(art),'d2affb01bfbb15e45bf0cd0283c98ef662ccd0bb','Original WebP bytes changed');
 assert.equal(art.toString('ascii',0,4),'RIFF');assert.equal(art.toString('ascii',8,12),'WEBP');
 assert.equal(art.readUIntLE(24,3)+1,1400);assert.equal(art.readUIntLE(27,3)+1,787);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.ok(html.length<50000,'Homepage must not re-embed the full below-fold artwork');
 assert.doesNotMatch(html,/data:image\/webp;base64,/);
 const buy=html.slice(html.indexOf('<section id="buy">'),html.indexOf('</section>',html.indexOf('<section id="buy">')));
 assert.match(buy,/<img src="\/assets\/arcy-community-illustration\.webp" alt="ARCY community illustration" width="1400" height="787" loading="lazy" decoding="async">/);
 assert.match(html,/<link rel="preload" as="image" href="\/assets\/arcy-hero-video-poster-v8\.webp" fetchpriority="high">/);
});
