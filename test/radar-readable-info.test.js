'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const addon=require('../search/radar-info-readable.js');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

const real='ARCY sıralaması #2 — MARKET_OPPORTUNITY_WATCH; Öncelik puanı 52.28/100 (yükseliş olasılığı değildir), veri kapsamı %100; En güçlü ölçütler: likidite/çıkış, organik hacim; Hacim $65K, likidite $224K, 24s -0.0%; Sıkışma: COMPRESSION_EMERGING; Değerleme: piyasa değeri $7.8M, FDV $7.9M, ağ içi göreli değerleme yüzdeliği 55; Kimlik: METADATA_CROSS_CORROBORATED, proje profili SELF_PUBLISHED_PROJECT_SITE, profil 68/100; Uyarılar: SUSPICIOUS_ACTIVITY, UNLOCK_SCHEDULE_NOT_MEASURED, ISSUER_NOT_OFFICIALLY_VERIFIED; Ölçülemeyen: yok; Güvenlik garantisi değildir, kontrat ve çıkış koşulları bağımsız incelenmelidir; Veri 2026-11-20 16:11 UTC';
test('V8 research Info: precise metrics and negative findings survive Turkish translation',()=>{
 const x=addon.translateReason(real);
 assert.equal(x.sections.length,11);
 assert.match(x.full,/52\.28\/100/);
 assert.match(x.full,/veri kapsamı %100/);
 assert.match(x.full,/24s hacim \$65K/);
 assert.match(x.full,/tam seyreltilmiş değer \(FDV\) \$7\.9M/);
 assert.match(x.full,/Sıkışma belirtileri oluşuyor/);
 assert.match(x.full,/Şüpheli işlem etkinliği sinyali/);
 assert.match(x.full,/Token kilit açılış takvimi ölçülmedi/);
 assert.match(x.full,/resmî kaynaklarla doğrulanamadı/);
 assert.match(x.full,/Güvenlik garantisi değildir/);
 assert.match(x.full,/2026-11-20 16:11 UTC/);
 assert.doesNotMatch(x.full,/MARKET_OPPORTUNITY_WATCH|COMPRESSION_EMERGING|SUSPICIOUS_ACTIVITY|ISSUER_NOT_OFFICIALLY_VERIFIED/);
 assert.equal(x.sections[7].title,'Risk ve dikkat noktaları');
 assert.equal(x.sections[9].title,'Bağımsız kontrol uyarısı');
});
test('Unknown risk and category codes are never hidden or invented',()=>{
 const x=addon.translateReason('ARCY sıralaması #1 — NEW_UNKNOWN_SIGNAL; Uyarılar: UNKNOWN_NEW_RISK');
 assert.match(x.full,/Açıklanmamış analiz kodu \(NEW_UNKNOWN_SIGNAL\)/);
 assert.match(x.full,/Açıklanmamış analiz kodu \(UNKNOWN_NEW_RISK\)/);
});
test('Legacy Info remains readable; empty source does not fabricate rationale',()=>{
 const x=addon.translateReason('new pool (2 d); 24h volume $55k; liquidity $40k; 128 trades; independently cross-verified');
 assert.match(x.full,/Yeni havuz \(2 gün\)/);
 assert.match(x.full,/24s hacim \$55k/);
 assert.match(x.full,/İki bağımsız kaynakla karşılaştırıldı/);
 assert.equal(addon.translateReason('').sections.length,0);
});
test('Additive integration: both radar routes load the same assets; protected core files stay unmodified',()=>{
 const js=read('search/radar-info-readable.js');
 const css=read('search/radar-info-readable.css');
 assert.match(read('radar-entry.js'),/\/search\/radar-info-readable\.js/);
 assert.match(read('search\/report-navigation.js'),/\/search\/radar-info-readable\.js/);
 assert.match(read('radar-entry.js'),/\/search\/radar-info-readable\.css/);
 assert.match(read('search\/report-navigation.js'),/\/search\/radar-info-readable\.css/);
 assert.match(js,/\.arcy-radar-overview-reason-info/);
 assert.match(js,/e\.stopImmediatePropagation\(\)/,'the legacy popup is intercepted instead of being changed');
 assert.match(js,/textContent/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.doesNotMatch(js,/\bfetch\s*\(/,'no provider requests from translated Info');
 assert.match(css,/overflow-y:auto/);
 assert.match(css,/-webkit-overflow-scrolling:touch/);
});
