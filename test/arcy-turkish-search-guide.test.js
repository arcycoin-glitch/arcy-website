'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8'),page=read('arcy-analiz.html'),home=read('index.html'),coin=read('arcy-coin.html'),trans=read('transparency.html'),sitemap=read('sitemap.xml');
test('Turkish page gives useful ARCY analiz/arama guidance instead of keyword spam',()=>{
 assert.match(page,/<html lang="tr">/);
 assert.match(page,/<title>ARCY Analiz ve ARCY Arama \| ARCY SEARCH Token Araştırma Rehberi<\/title>/);
 assert.match(page,/<h1>ARCY Analiz ve ARCY Arama<\/h1>/);
 assert.match(page,/Ağ seçin/);assert.match(page,/Kontrat adresini kontrol edin/);assert.match(page,/Kanıt düzeyini ayırın/);
 assert.match(page,/Arc, Ethereum ve Robinhood Chain/);
 assert.doesNotMatch(page,/meta name="keywords"/i);
});
test('Turkish token research guide is canonical, source-linked and honest on risk',()=>{
 assert.match(page,/<link rel="canonical" href="https:\/\/www\.arcyusdc\.xyz\/arcy-analiz\.html">/);
 assert.match(page,/href="\/#search"/);
 assert.match(page,/href="\/transparency\.html"/);
 assert.match(page,/href="\/arcy-coin\.html"/);
 assert.match(page,/Eski tokenın otomatik olarak yeni tokena dönüşeceği/);
 assert.match(page,/bağımsız güvenlik denetimi, yatırım tavsiyesi, token fiyatı veya kâr garantisi vermez/);
 assert.doesNotMatch(page,/0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b/);
 const schema=page.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/);
 assert.ok(schema);
 const data=JSON.parse(schema[1]);assert.equal(data.inLanguage,'tr');assert.equal(data['@type'],'WebPage');
});
test('Turkish SEO route remains findable from canonical sitemap and both established brand pages',()=>{
 assert.match(sitemap,/https:\/\/www\.arcyusdc\.xyz\/arcy-analiz\.html/);
 assert.match(home,/href="\/arcy-analiz\.html" lang="tr"/);
 assert.match(coin,/href="\/arcy-analiz\.html" lang="tr"/);
 assert.match(trans,/href="\/arcy-analiz\.html" lang="tr"/);
 assert.match(home,/DETAILS TO BE ANNOUNCED/);
 assert.doesNotMatch(home,/async function loadBurn\(/);
});
