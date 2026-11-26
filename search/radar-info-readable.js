'use strict';
// Additive Radar Info enhancement. The approved Radar renderer, API, ranking and immutable UI assets are untouched.
// Event delegation intercepts ONLY the on-demand selection Info control; source data is displayed with textContent.
(function(factory){
 const addon=factory();
 if(typeof module==='object'&&module.exports)module.exports=addon;
 if(typeof document!=='undefined'&&document.addEventListener)addon.install(document);
})(function(){
 'use strict';
 const RADAR_CODE_TR=Object.freeze({
  MARKET_OPPORTUNITY_WATCH:'Piyasa fırsatı izleme listesi (yatırım önerisi değil)',
  STRONG_RESEARCH_SIGNAL:'Güçlü araştırma sinyali (yatırım önerisi değil)',
  LOW_CONFIDENCE_WATCH:'Düşük güven düzeyinde izleme',
  COMPRESSION_EMERGING:'Sıkışma belirtileri oluşuyor; kesinleşmiş değil',
  NO_COMPRESSION_EVIDENCE:'Sıkışmayı doğrulayacak yeterli veri yok',
  INSUFFICIENT_HISTORY:'Geçmiş veri yetersiz',
  OFFICIAL_CONTRACT_VERIFIED:'Kontrat adresi resmî kaynakla eşleştirildi; güvenlik denetimi değildir',
  METADATA_CROSS_CORROBORATED:'Token bilgileri birden fazla kaynakla karşılaştırıldı; ihraççı doğrulaması değildir',
  OFFICIAL_PROJECT:'Resmî proje profiliyle eşleştirildi',
  SELF_PUBLISHED_PROJECT_SITE:'Projenin yayımladığı internet sitesi; bağımsız doğrulama değildir',
  PROJECT_CHANNELS_LISTED:'Proje kanalları listelenmiş; resmîlikleri ayrıca doğrulanmalı',
  SUSPICIOUS_ACTIVITY:'Şüpheli işlem etkinliği sinyali; kesin manipülasyon kanıtı değildir',
  UNLOCK_SCHEDULE_NOT_MEASURED:'Token kilit açılış takvimi ölçülmedi',
  ISSUER_NOT_OFFICIALLY_VERIFIED:'Tokenı çıkaran taraf resmî kaynaklarla doğrulanamadı',
  INCOMPLETE_RESEARCH_PROFILE:'Proje araştırma profilinde eksik bilgiler var',
  PROJECT_CHANNELS_UNVERIFIED:'Projenin iletişim kanalları doğrulanamadı',
  LARGE_CAP_LIMITED_ASYMMETRY:'Yüksek piyasa değeri erken keşif potansiyelini sınırlayabilir',
  SINGLE_POOL_CONCENTRATION:'İşlem hacmi tek havuzda yoğunlaşmış',
  BELOW_RESEARCH_LIQUIDITY_FLOOR:'Araştırma için belirlenen likidite eşiğinin altında',
  CIRCULATING_SUPPLY_NOT_MEASURED:'Dolaşımdaki arz ölçülmedi',
  CRASH_NOT_UNDERVALUATION:'Sert düşüş, düşük değerlemenin kanıtı değildir',
  DILUTION_RISK_LOW_CIRCULATING_SHARE:'Düşük dolaşım oranı nedeniyle token seyrelme riski',
  EXCESSIVE_VOLUME_TO_LIQUIDITY:'Hacim/likidite oranı olağan dışı yüksek',
  HISTORICAL_PRICE_EVENT:'Geçmişte önemli fiyat hareketi gözlemlenmiş',
  SHARP_DAILY_FALL:'Son 24 saatte sert fiyat düşüşü'
 });
 function explainDiscovery(raw){
  if(typeof raw!=='string'||!raw.trim())return {short:'NOT VERIFIED',full:'NOT VERIFIED',sections:[]};
  const parts=raw.split(';').map(x=>x.trim()).filter(Boolean).slice(0,24);
  const codes=part=>part.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
   code=>RADAR_CODE_TR[code]||'Açıklanmamış analiz kodu ('+code+')');
  const tr=part=>{
   let m;
   if((m=/^new pool \((<1|\d+) d\)$/i.exec(part)))return 'Yeni havuz ('+m[1]+' gün)';
   if((m=/^recent pool \((\d+) d\)$/i.exec(part)))return 'Yakın tarihli havuz ('+m[1]+' gün)';
   if((m=/^(\d+) trades$/i.exec(part)))return m[1]+' işlem / 24s';
   if(/^24h volume /i.test(part))return part.replace(/^24h volume /i,'24s hacim ');
   if(/^liquidity /i.test(part))return part.replace(/^liquidity /i,'Likidite ');
   if(part==='independently cross-verified')return 'İki bağımsız kaynakla karşılaştırıldı';
   if(part==='tokenized equity')return 'Tokenize hisse';
   if(/^watch:/i.test(part))return '⚠ İzleme sinyali: '+codes(part.replace(/^watch:\s*/i,''));
   if(/^Değerleme:/i.test(part))return codes(part).replace(/\bFDV\b/g,'tam seyreltilmiş değer (FDV)');
   if(/^Hacim \$/i.test(part))return codes(part).replace(/^Hacim /,'24s hacim ');
   return codes(part);
  };
  const label=part=>{
   if(/^ARCY sıralaması/i.test(part))return 'Sıralama ve araştırma sinyali';
   if(/^Öncelik puanı/i.test(part))return 'Öncelik puanı ve veri kapsamı';
   if(/^En güçlü ölçütler/i.test(part))return 'Puanı etkileyen ölçütler';
   if(/^Hacim \$/i.test(part))return 'Hacim, likidite ve fiyat değişimi';
   if(/^Sıkışma:/i.test(part))return 'Sıkışma değerlendirmesi';
   if(/^Değerleme:/i.test(part))return 'Piyasa değeri ve değerleme';
   if(/^Kimlik:/i.test(part))return 'Proje kimliği ve kanıt düzeyi';
   if(/^Uyarılar:/i.test(part)||/^watch:/i.test(part))return 'Risk ve dikkat noktaları';
   if(/^Ölçülemeyen:/i.test(part))return 'Ölçülemeyen alanlar';
   if(/^Güvenlik garantisi/i.test(part))return 'Bağımsız kontrol uyarısı';
   if(/^Veri \d{4}-/.test(part))return 'Veri zamanı (UTC)';
   return 'Araştırma notu';
  };
  const translated=parts.map(tr);
  const sections=parts.map((part,i)=>({title:label(part),text:translated[i]}));
  const warnings=translated.filter(x=>x.startsWith('⚠'));
  const featured=translated.filter(x=>!x.startsWith('⚠')).slice(0,3);
  if(warnings.length)featured.push(warnings.join(' · '));
  return {short:featured.join(' · ')||'NOT VERIFIED',full:translated.join(' · ')||'NOT VERIFIED',sections};
 }


 // Additive recovery only: the immutable Radar renderer retains full control of
 // Retry-After, disabled buttons, cache provenance, API validation and ranking.
 // A real network request happens only by activating its already enabled manual
 // retry control once, after that control transitions out of cooldown.
 function installRetryRecovery(doc){
  const Observer=doc.defaultView?.MutationObserver;
  if(typeof Observer!=='function')return false;
  let overview=null;
  const sawCooldown=new Set(),retried=new Set(),pending=new Set();
  const offsets={arc:0,ethereum:2000,robinhood:4000,pons:6000};
  const schedule=doc.defaultView.setTimeout?.bind(doc.defaultView)||setTimeout;
  const cardFor=network=>Array.from(overview?.querySelectorAll('[data-overview]')||[])
   .find(card=>card.dataset.overview===network);
  const eligible=network=>{
   const card=cardFor(network),button=card?.querySelector('.arcy-radar-overview-action');
   return card&&!card.hidden&&button&&!button.disabled&&button.textContent==='Yeniden Dene ↻'?button:null;
  };
  const run=network=>{
   if(retried.has(network)){pending.delete(network);return;}
   if(doc.visibilityState==='hidden'){
    const onVisible=()=>{
     if(doc.visibilityState==='hidden')return;
     doc.removeEventListener('visibilitychange',onVisible);
     pending.delete(network);
     const button=eligible(network);
     if(button&&!retried.has(network)){retried.add(network);button.click();}
     else scan(); // A different selected network must not consume this recovery.
    };
    doc.addEventListener('visibilitychange',onVisible);
    return;
   }
   pending.delete(network);
   const button=eligible(network);
   if(button&&!retried.has(network)){retried.add(network);button.click();}
   // If another network is selected now, the MutationObserver can try again
   // when the original card is shown; no extra provider call is made.
  };
  const scan=()=>{
   if(!overview)return;
   for(const card of overview.querySelectorAll('[data-overview]')){
    const network=card?.dataset?.overview;
    if(!Object.hasOwn(offsets,network))continue;
    const button=card.querySelector('.arcy-radar-overview-action');
    if(!button)continue;
    if(button.disabled&&button.textContent==='Kaynak bekleme süresinde')sawCooldown.add(network);
    // If a user has retried manually while an automatic recovery was queued,
    // do not send a second request when the old timer fires.
    if(pending.has(network)&&button.disabled&&button.textContent==='Kontrol ediliyor…'){
     pending.delete(network);retried.add(network);
    }
    if(!sawCooldown.has(network)||retried.has(network)||pending.has(network)||!eligible(network))continue;
    pending.add(network);
    schedule(()=>run(network),offsets[network]);
   }
  };
  const observer=new Observer(scan);
  const mount=()=>{
   const found=doc.querySelector('.arcy-radar-overview');
   if(!found)return false;
   overview=found;
   observer.observe(overview,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden']});
   scan();
   return true;
  };
  if(!mount()){
   // The optional script is async. It can arrive before the Radar renderer
   // creates its overview; install once it appears rather than silently fail.
   const boot=new Observer(()=>{if(mount())boot.disconnect();});
   boot.observe(doc.documentElement||doc,{subtree:true,childList:true});
  }
  return true;
 }

 function install(doc){
  if(doc.__arcyRadarReadableInfo)return;
  doc.__arcyRadarReadableInfo=true;
  let owner=null,sheet=null;
  const el=(tag,cls,copy)=>{
   const x=doc.createElement(tag);if(cls)x.className=cls;
   if(copy!==undefined)x.textContent=copy;return x;
  };
  const close=(restoreFocus=false)=>{
   const old=owner;
   if(old){old.setAttribute('aria-expanded','false');old.removeAttribute('aria-describedby');}
   owner=null;
   if(sheet){sheet.remove();sheet=null;}
   if(restoreFocus&&old?.isConnected)old.focus();
  };
  const open=control=>{
   close(false);
   const reason=control.dataset.reason||'';
   const details=explainDiscovery(reason);
   if(!details.sections.length)return;
   const card=control.closest('.arcy-radar-overview-token');
   const name=card?.querySelector('.arcy-radar-overview-token-ticker')?.textContent||'Token';
   const cardScore=card?.querySelector('.arcy-radar-overview-score-value')?.textContent||'';
   sheet=el('div','arcy-radar-readable-info');
   sheet.id='arcyRadarReadableInfo';
   sheet.setAttribute('role','dialog');
   sheet.setAttribute('aria-modal','false');
   sheet.setAttribute('aria-label',name+' Radar araştırma açıklaması');
   const head=el('div','arcy-radar-readable-info-head');
   head.append(el('strong','arcy-radar-readable-info-title',name+' · Neden listede?'));
   const dismiss=el('button','arcy-radar-readable-info-close','Kapat ×');dismiss.type='button';
   dismiss.setAttribute('aria-label','Bilgi penceresini kapat');
   dismiss.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();close(true);});
   head.append(dismiss);sheet.append(head);
   if(cardScore&&details.sections.some(s=>s.title==='Öncelik puanı ve veri kapsamı')){
    sheet.append(el('p','arcy-radar-readable-info-score-note',
     'Karttaki '+cardScore+'/100 Discovery Score ile aşağıdaki ARCY öncelik puanı farklı araştırma ölçümleridir. İkisi de yükseliş olasılığı veya getiri tahmini değildir.'));
   }
   for(const part of details.sections){
    const section=el('section','arcy-radar-readable-info-section');
    if(/^(Risk ve dikkat noktaları|Bağımsız kontrol uyarısı)$/.test(part.title))section.classList.add('is-warning');
    section.append(el('strong','arcy-radar-readable-info-label',part.title),el('p','arcy-radar-readable-info-copy',part.text));
    sheet.append(section);
   }
   doc.body.append(sheet);
   const viewport=Math.max(200,doc.documentElement.clientWidth),vh=Math.max(240,window.innerHeight||800);
   const w=Math.min(440,viewport-24);
   sheet.style.width=w+'px';
   sheet.style.maxHeight=Math.max(180,Math.floor(vh*.78))+'px';
   sheet.style.overflowY='auto';
   const rect=control.getBoundingClientRect();
   sheet.style.left=(viewport<=640?Math.max(8,(viewport-w)/2):
    Math.max(8,Math.min(rect.left+rect.width/2-w/2,viewport-w-8)))+'px';
   sheet.style.top=(viewport<=640?Math.max(8,Math.floor(vh*.09)):
    Math.max(8,Math.min(rect.bottom+8,vh-Math.min(sheet.offsetHeight,vh-20)-8)))+'px';
   owner=control;
   owner.setAttribute('aria-expanded','true');
   owner.setAttribute('aria-describedby',sheet.id);
   dismiss.focus();
  };
  // Capture beats the legacy Info listener but leaves all 24h source tooltips unchanged.
  doc.addEventListener('click',e=>{
   const target=e.target?.closest?.('.arcy-radar-overview-reason-info');
   if(!target)return;
   e.preventDefault();e.stopImmediatePropagation();
   if(owner===target)close(false);else open(target);
  },true);
  doc.addEventListener('keydown',e=>{
   if(e.key==='Escape'&&owner){
    e.preventDefault();e.stopImmediatePropagation();close(true);return;
   }
   const target=e.target?.closest?.('.arcy-radar-overview-reason-info');
   if(!target||(e.key!=='Enter'&&e.key!==' '))return;
   e.preventDefault();e.stopImmediatePropagation();
   if(owner===target)close(false);else open(target);
  },true);
  doc.addEventListener('click',e=>{
   if(!owner)return;
   if(sheet?.contains(e.target))return;
   close(false);
  });
  if(typeof window!=='undefined')window.addEventListener('resize',()=>{if(owner)close(false);},{passive:true});
  installRetryRecovery(doc);
 }
 return Object.freeze({translateReason:explainDiscovery,install});
});
