'use strict';
// ARCY Token Research — additive readability layer for the Holder & Whale and Contract & Mechanics cards.
// Reads ONLY the card object the immutable report renderer already placed in the card ("Technical evidence JSON");
// no request, no recalculation of holders/whales/mechanics, no change to the card's position, values or evidence panel.
// It adds a short Turkish summary that keeps three states apart: CONFIRMED, NOT DETECTED and NOT VERIFIED.
// A field that was not reviewed is never described as safe; missing data is never shown as zero or estimated.
(()=>{
 const NODE=typeof document==='undefined';
 if(!NODE&&window.ARCYResearchCardsReadable)return;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const nt=n=>{n.setAttribute('translate','no');n.classList.add('notranslate');return n;};
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const present=f=>!!f&&f.dataState==='DATA_FOUND'&&f.value!==null&&f.value!==undefined;
 const dateTR=iso=>{const t=Date.parse(iso||'');return Number.isFinite(t)?new Date(t).toLocaleDateString('tr-TR',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})+' UTC':null;};
 const safeUrl=u=>{try{const x=new URL(u);return x.protocol==='https:'&&!x.username&&!x.password&&!x.port&&x.href.length<700?x.href:null;}catch{return null;}};
 const STATE={
  CONFIRMED:['DOĞRULANDI','CONFIRMED','ok'],NOT_DETECTED:['TESPİT EDİLMEDİ','NOT DETECTED','ok-soft'],
  GETTER_REPORTED:['GETTER RAPORU','GETTER REPORTED','info'],SOURCE_REPORTED:['KAYNAK BİLDİRİMİ','SOURCE REPORTED','info'],
  HISTORICAL:['GEÇMİŞ KANIT','HISTORICAL','warn'],STALE:['ESKİ VERİ','STALE','warn'],NOT_VERIFIED:['DOĞRULANAMADI','NOT VERIFIED','no'],
  NOTE:['İNCELEME NOTU','REVIEW NOTE','info']};
 // Exported for tests. Mirrors the evidence states the report renderer already distinguishes.
 function stateOf(f){
  if(!present(f))return 'NOT_VERIFIED';
  if(f.freshness?.state==='LAST_VERIFIED'||f.status==='HISTORICAL_ONCHAIN_VERIFIED')return 'HISTORICAL';
  if(f.freshness?.state==='STALE'||f.status==='STALE')return 'STALE';
  if(f.status==='NOT_DETECTED')return 'NOT_DETECTED';
  if(f.status==='GETTER_REPORTED')return 'GETTER_REPORTED';
  if(f.status==='SOURCE_REPORTED'||f.status==='SOURCE_REPORTED_RPC_RECONCILED')return 'SOURCE_REPORTED';
  return 'CONFIRMED';
 }
 function chip(state){const s=STATE[state];const c=el('span','arcy-rc-chip arcy-rc-'+s[2]);c.append(el('b','',s[0]),nt(el('small','',s[1])));return c;}
 function anchor(f){
  const p=Array.isArray(f?.evidence)?f.evidence[0]:null,b=p?.block||p?.atBlock;
  let block=null;try{if(typeof b==='string'&&/^0x[0-9a-f]+$/i.test(b))block=BigInt(b).toString();}catch{}
  return {block,observed:f?.freshness?.observedAt||null,url:safeUrl(p?.sourceUrl||p?.url||''),source:f?.source||null};
 }
 function line(label,state,text,value,extra){
  const row=el('div','arcy-rc-row');
  const head=el('div','arcy-rc-row-head');head.append(el('span','arcy-rc-label',label),chip(state));
  row.append(head);
  if(value!==undefined&&value!==null&&value!==''){const v=nt(el('code','arcy-rc-value',String(value).slice(0,220)));row.append(v);}
  row.append(el('p','arcy-rc-text',text));
  if(extra)row.append(extra);
  return row;
 }
 // ── Holder & Whale ────────────────────────────────────────────────────────────────────────────────────────────
 const ROLE={BURN_ADDRESS:'Yakım adresi (dolaşımda değil)',UNKNOWN:'Rolü doğrulanmamış adres'};
 function roleLabel(r){const k=String(r||'UNKNOWN').toUpperCase();if(ROLE[k])return ROLE[k];
  if(/POOL|PAIR|LP\b|LIQUIDITY/.test(k))return 'Doğrulanmış likidite havuzu (cüzdan değil)';
  if(/LOCK|VEST/.test(k))return 'Kilit / vesting kontratı';if(/EXCHANGE|CEX/.test(k))return 'Borsa adresi';return k.replace(/_/g,' ').toLowerCase();}
 function concentrationText(top10){
  if(!finite(top10))return null;
  if(top10>=50)return 'İlk 10 adres arzın yarısından fazlasını tutuyor: yüksek yoğunlaşma. Bu adreslerin satışı fiyatı belirgin etkileyebilir.';
  if(top10>=20)return 'İlk 10 adres arzın kayda değer bir kısmını tutuyor: orta düzey yoğunlaşma.';
  return 'Arz ilk 10 adreste yoğunlaşmamış görünüyor: daha dağınık bir dağılım.';
 }
 function holders(card){
  const F=card?.fields||{},box=el('section','arcy-rc-panel');box.lang='tr';box.setAttribute('aria-label','Holder özeti');
  box.append(el('h3','arcy-rc-title','Kısaca: cüzdan yoğunlaşması'));
  const pctVal=k=>present(F[k])&&finite(Number(F[k].value))?Number(F[k].value):null;
  const hc=F.holderCount;
  box.append(line('Holder sayısı',stateOf(hc),present(hc)?'Bu kontratı tutan adres sayısı (kaynağın bildirdiği an itibarıyla).':'Holder sayısı doğrulanamadı; sıfır veya tahmini bir değer gösterilmez.',present(hc)?(Number.isSafeInteger(Number(hc.value))?Number(hc.value).toLocaleString('tr-TR'):String(hc.value)):null));
  const bars=el('div','arcy-rc-bars');
  for(const [k,label] of [['largestWalletPct','En büyük adres'],['top10Pct','İlk 10 adres'],['top20Pct','İlk 20 adres']]){
   const v=pctVal(k),b=el('div','arcy-rc-bar');
   b.append(el('span','arcy-rc-bar-label',label));
   const track=el('span','arcy-rc-bar-track');const fill=el('span','arcy-rc-bar-fill');
   if(v!==null){fill.style.width=Math.max(0,Math.min(100,v))+'%';}else track.classList.add('is-empty');
   track.append(fill);b.append(track,nt(el('b','arcy-rc-bar-value',v===null?'DOĞRULANAMADI':(v<0.01&&v>0?'<0.01':v.toFixed(2))+'%')));
   bars.append(b);
  }
  box.append(bars);
  const top10=pctVal('top10Pct'),ct=concentrationText(top10);
  box.append(el('p','arcy-rc-text',(ct?ct+' ':'')+'Büyük adresler her zaman “balina” değildir: likidite havuzu, borsa, kilit kontratı veya yakım adresi olabilir. Rolü doğrulanmamış bir adresin kime ait olduğu bilinmez.'));
  // address roles (only when the engine supplied reconciled candidates)
  const cands=Array.isArray(card?.holderCandidates)?card.holderCandidates.filter(c=>/^0x[0-9a-f]{40}$/i.test(c?.address||'')&&finite(c?.sharePct)):[];
  if(cands.length){
   const roles=new Map();for(const c of cands){const l=roleLabel(c.role);roles.set(l,(roles.get(l)||0)+1);}
   const ul=el('ul','arcy-rc-roles');for(const [l,n] of roles)ul.append(el('li','',n+' × '+l));
   box.append(el('p','arcy-rc-subtitle','İncelenen büyük adreslerin rolleri ('+cands.length+' aday)'),ul);
  }else box.append(el('p','arcy-rc-muted','Bu ağ veya token için adres rolü ayrımı sağlanmıyor; büyük adreslerin havuz mu cüzdan mı olduğu bu kartta doğrulanmadı.'));
  box.append(freshness(F,['top10Pct','holderCount','largestWalletPct','top20Pct']));
  return box;
 }
 function freshness(F,order){
  const f=order.map(k=>F[k]).find(present);
  const p=el('p','arcy-rc-when');
  if(!f){p.textContent='Veri zamanı: doğrulanmış değer yok.';return p;}
  const a=anchor(f),st=stateOf(f);
  const parts=[];
  if(a.block)parts.push('Blok '+a.block);
  if(a.observed&&dateTR(a.observed))parts.push(dateTR(a.observed));
  if(a.source)parts.push('Kaynak: '+a.source);
  p.textContent=(st==='HISTORICAL'?'⚠ GEÇMİŞ VERİ — güncel değil. ':st==='STALE'?'⚠ ESKİ VERİ — güncel değil. ':'Veri zamanı: ')+(parts.join(' · ')||'zaman bilgisi kaynakta yok');
  if(st==='HISTORICAL'||st==='STALE')p.classList.add('is-warn');
  if(a.url){const link=el('a','arcy-rc-link','Birincil kaynağı aç ↗');link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';p.append(document.createTextNode(' '),link);}
  return p;
 }
 // ── Contract & Mechanics ────────────────────────────────────────────────────────────────────────────────────
 function taxes(f){
  const st=stateOf(f);if(st==='NOT_VERIFIED')return [st,'Alış, satış ve transfer vergileri doğrulanamadı. Bu, vergi olmadığı anlamına gelmez.'];
  const s=String(f.value),n=k=>{const m=new RegExp('\\b'+k+'\\s+([0-9]+(?:\\.[0-9]+)?)%').exec(s);return m?Number(m[1]):null;};
  const vals={Alış:n('Buy'),Satış:n('Sell'),Transfer:n('Transfer')};
  const found=Object.entries(vals).filter(([,v])=>v!==null);
  const pos=found.filter(([,v])=>v>0);
  let t=found.length?(pos.length?pos.map(([k,v])=>k+' %'+v).join(', ')+' vergi kesiliyor: işlem başına bu oran kadar token kaybedilir.':'Ölçülen işlem türlerinde vergi %0.'):'Vergi değeri kaynakta yapılandırılmış biçimde yok.';
  const missing=Object.entries(vals).filter(([,v])=>v===null).map(([k])=>k);
  if(found.length&&missing.length)t+=' '+missing.join(', ')+' vergisi raporlanmadı.';
  if(/NOT VERIFIED/i.test(s))t+=' DEX / hook ücretleri doğrulanmadı.';
  return [st,t];
 }
 function mint(f){
  const st=stateOf(f);if(st==='NOT_VERIFIED')return [st,'Yeni token basma (mint) yetkisi doğrulanamadı. İncelenmemiş olması güvenli olduğu anlamına gelmez.'];
  const s=String(f.value);
  if(/^NONE|No current minter|No direct mint/i.test(s)){
   let t='İncelenen kaynakta aktif bir mint yolu bulunmadı; arz bu kontrat üzerinden artırılamıyor görünüyor.';
   if(/admin can grant/i.test(s))t='Şu an mint yetkisi olan adres yok, ancak yönetici bu yetkiyi verebilir.';
   if(/upgradeable/i.test(s))t+=' Kontrat yükseltilebilir olduğu için bu durum ileride değişebilir.';
   return [st,t];
  }
  return [st,'Yeni token basılabilir. Arz artışı mevcut sahipleri sulandırabilir; yetkinin kimde olduğu ve sınırı ayrıca incelenmeli.'];
 }
 function owner(f){
  const st=stateOf(f);if(st==='NOT_VERIFIED')return [st,'Sahip / yönetici (owner / admin) kontrolü doğrulanamadı. Yetki olup olmadığı bilinmiyor.'];
  const s=String(f.value);
  if(/renounced|^NONE DETECTED|^No token owner/i.test(s))return [st,'Token üzerinde sahip veya yönetici yetkisi tespit edilmedi'+(/renounced/i.test(s)?' (sahiplik devredilmiş / renounce edilmiş)':'')+'. Bu, yalnızca incelenen yetki yolları için geçerlidir.'];
  return [st,'Kontratı yönetebilen bir yetki var (yukarıdaki değer). Bu yetki parametreleri değiştirebilir; kimin elinde olduğu ve zaman kilidi olup olmadığı incelenmeli.'];
 }
 function proxy(arch,ownerF,mintF){
  const st=stateOf(arch);
  if(st!=='NOT_VERIFIED'){
   const s=String(arch.value);
   if(/NON-PROXY/i.test(s))return [st,'İncelenen kanıtta standart proxy mimarisi tespit edilmedi. Bu sonuç, tüm dolaylı yükseltme veya yetki yollarının bulunmadığını tek başına kanıtlamaz.'];
   if(/proxy|UUPS|beacon|implementation/i.test(s))return [st,'Yükseltilebilir (proxy) kontrat: yönetici kontratın kodunu sonradan değiştirebilir. Bugünkü güvenli görünüm yarın değişebilir; yükseltme yetkisinin kimde olduğu ve zaman kilidi ayrıca incelenmeli.'];
  }
  if(present(ownerF)&&/Proxy admin/i.test(String(ownerF.value)))return [stateOf(ownerF),'Bir proxy yöneticisi raporlandı: kontrat kodu yükseltilebilir olabilir; ayrıca incelenmeli.'];
  if(present(mintF)&&/upgradeable/i.test(String(mintF.value)))return [stateOf(mintF),'Kontrat yükseltilebilir olarak raporlandı: kod sonradan değiştirilebilir.'];
  return ['NOT_VERIFIED','Proxy / yükseltme durumu doğrulanamadı. Yükseltilemez olduğu varsayılmamalı.'];
 }
 function pause(ownerF,notes){
  if(present(ownerF)){const s=String(ownerF.value);const negative=/\bno\s+(?:direct\s+)?pause\b|\bpause\b.{0,35}\b(?:not detected|not found|unavailable|unsupported|absent|disabled)\b/i;
   if(/\bpause\b/i.test(s)&&!negative.test(s))return [stateOf(ownerF),'İncelenen owner/admin kanıtında durdurma (pause / unpause) yetkisi bildiriliyor. Bu yetki transferleri etkileyebilir; hangi rolün kullanabildiği ayrıca doğrulanmalı.'];}
  const note=(Array.isArray(notes)?notes:[]).find(n=>typeof n==='string'&&/\bno pause\b/i.test(n));
  if(note)return ['NOTE','İncelenen kaynak kodunda pause fonksiyonu bulunmadığı not edilmiş. Bu not kaynak incelemesine dayanır; ayrı bir zincir üstü kontrol değildir.'];
  return ['NOT_VERIFIED','Durdurma (pause / unpause) yetkisi bu motor tarafından ayrıca raporlanmadı. Yetki olmadığı anlamına gelmez.'];
 }
 function architecture(f){
  const st=stateOf(f);if(st==='NOT_VERIFIED')return [st,'Kontrat mimarisi doğrulanamadı.'];
  return [st,'Kontratın yapısı (proxy olup olmadığı, hangi şablon) zincir üstü kod veya doğrulanmış kaynakla incelendi.'];
 }
 function mechanics(card){
  const F=card?.fields||{},box=el('section','arcy-rc-panel');box.lang='tr';box.setAttribute('aria-label','Kontrat mekaniği özeti');
  box.append(el('h3','arcy-rc-title','Kısaca: kontrat nasıl çalışıyor?'));
  const legend=el('p','arcy-rc-legend');
  legend.append(chip('CONFIRMED'),document.createTextNode(' kanıtla doğrulandı · '),chip('NOT_DETECTED'),document.createTextNode(' kontrol edildi, bulunmadı · '),chip('NOT_VERIFIED'),document.createTextNode(' incelenemedi — güvenli kabul edilmemeli'));
  box.append(legend);
  const rows=[['Alış / satış / transfer vergileri',taxes(F.tradingTaxes),F.tradingTaxes],
   ['Mint (yeni token basma) yetkisi',mint(F.mintCapability),F.mintCapability],
   ['Owner / admin kontrolü',owner(F.ownerAdmin),F.ownerAdmin],
   ['Proxy / yükseltme yetkisi',proxy(F.contractArchitecture,F.ownerAdmin,F.mintCapability),null],
   ['Pause / unpause yetkisi',pause(F.ownerAdmin,card?.researchNotes),null],
   ['Kontrat mimarisi',architecture(F.contractArchitecture),F.contractArchitecture]];
  for(const [label,[state,text],field] of rows)box.append(line(label,state,text,present(field)?field.value:null));
  const unverified=[['tradingTaxes','Vergiler'],['mintCapability','Mint'],['ownerAdmin','Owner / admin'],['contractArchitecture','Mimari']].filter(([k])=>!present(F[k]));
  const extra=[];if(present(F.tradingTaxes)&&/NOT VERIFIED/i.test(String(F.tradingTaxes.value)))extra.push('DEX / hook ücretleri');
  const u=el('div','arcy-rc-unverified');
  u.append(el('p','arcy-rc-subtitle','Doğrulanamayan mekanikler'));
  if(unverified.length||extra.length){const ul=el('ul','arcy-rc-roles');
   for(const [k,l] of unverified)ul.append(el('li','',l+': '+(typeof F[k]?.reason==='string'&&F[k].reason?F[k].reason.slice(0,160):'kanıt yok')));
   for(const l of extra)ul.append(el('li','',l+': doğrulanmadı'));u.append(ul);}
  else u.append(el('p','arcy-rc-muted','Dört alan da bir kaynakla raporlandı. Pause gibi ayrıca raporlanmayan yetkiler yukarıda ayrıca belirtilmiştir.'));
  box.append(u,freshness(F,['contractArchitecture','ownerAdmin','mintCapability','tradingTaxes']));
  box.append(el('p','arcy-rc-muted','Bu özet bir güvenlik garantisi değildir; yalnızca motorun bu kontrat için bulduğu kanıtları açıklar.'));
  return box;
 }
 function cardJson(section){
  const pre=section.querySelector('details.advanced-proof pre');
  try{return pre?JSON.parse(pre.textContent):null;}catch{return null;}
 }
 function enhance(section){
  const id=section.dataset.cardId;if(id!=='holders'&&id!=='mechanics')return;
  if(section.querySelector(':scope > .arcy-rc-disclosure'))return;
  const card=cardJson(section);if(!card||!card.fields)return; // not scanned yet: the original card already says so
  // Preserve the exact four original metrics and their existing evidence controls.
  // The supplementary explanations are opt-in and appear AFTER those metrics,
  // not above them. A native details/summary pair keeps them keyboard accessible.
  const disclosure=el('details','arcy-rc-disclosure');
  const summary=el('summary','arcy-rc-disclosure-toggle',id==='holders'?
   'Cüzdan yoğunlaşması · Ayrıntılı açıklamaları göster':
   'Kontrat mekanikleri · Ayrıntılı açıklamaları göster');
  disclosure.append(summary,id==='holders'?holders(card):mechanics(card));
  disclosure.open=false;
  const status=section.querySelector(':scope > .statusLine');
  if(status)status.before(disclosure);
  else section.append(disclosure);
 }
 function scan(){for(const s of document.querySelectorAll('#cards section.card[data-card-id]'))enhance(s);}
 if(NODE){if(typeof module==='object'&&module.exports)module.exports={stateOf,taxes,mint,owner,proxy,pause,concentrationText,roleLabel,holders,mechanics};return;}
 window.ARCYResearchCardsReadable={stateOf,taxes,mint,owner,proxy,pause,concentrationText,roleLabel,holders,mechanics};
 scan();
 const root=document.getElementById('cards')||document.documentElement;
 new MutationObserver(()=>scan()).observe(root,{childList:true,subtree:true});
})();
