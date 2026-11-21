'use strict';
// ARCY Market Radar — additive in-list search (owner request 2026-11-21).
// Filters ONLY the candidates the immutable Market Radar renderer has already loaded for the SELECTED network card.
// No network request, no discovery, no re-ranking, no score/Info change: rows are only shown or hidden, in place.
// Matching (case-insensitive): token symbol, token name, or the FULL exact 0x contract address (42 chars). A partial
// address never matches, so a contract is never confused with a look-alike. Networks stay separate (Pons ≠ Robinhood).
(()=>{
 const NODE=typeof document==='undefined';
 if(!NODE&&window.ARCYRadarSearch)return;
 const ADDRESS=/^0x[0-9a-f]{40}$/i;
 const NET_NAME={arc:'Arc',ethereum:'Ethereum',robinhood:'Robinhood',pons:'Pons Launch'};
 const norm=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 // Exact contract from the row's own research link (/search/token/<net>/<0x…>); rows without a contract have none.
 function rowAddress(row){const m=/\/search\/token\/[a-z]+\/(0x[0-9a-fA-F]{40})\/?$/.exec(row.getAttribute('href')||'');return m?m[1].toLowerCase():null;}
 function rowInfo(row){
  const symbol=row.querySelector('.arcy-radar-overview-token-ticker')?.textContent||'';
  const nameNode=row.querySelector('.arcy-radar-overview-token-name');
  // the renderer shows a shortened address in the name slot when a token has no separate name: not a token name
  const nameText=nameNode?.textContent||'';
  const name=/^0x[0-9a-f]{5}…[0-9a-f]{4}$/i.test(nameText)||nameText==='Native asset'?'':nameText;
  return {symbol:norm(symbol),name:norm(name),address:rowAddress(row),rawSymbol:symbol.trim()};
 }
 // Pure matcher (exported for tests): returns {match, kind}
 function matches(info,query){
  const q=norm(query);
  if(!q)return {match:true,kind:null};
  if(q.startsWith('0x')){
   if(!ADDRESS.test(q))return {match:false,kind:'PARTIAL_ADDRESS'};
   return {match:info.address===q,kind:'ADDRESS'};
  }
  if(info.symbol&&(info.symbol===q||info.symbol.startsWith(q)))return {match:true,kind:'SYMBOL'};
  if(info.name&&info.name.includes(q))return {match:true,kind:'NAME'};
  return {match:false,kind:null};
 }
 function mount(panel){
  if(!panel||panel.querySelector('.arcy-radar-search'))return;
  const overview=panel.querySelector('.arcy-radar-overview');
  if(!overview)return;
  const box=el('div','arcy-radar-search');box.setAttribute('role','search');
  const label=el('label','arcy-radar-search-label','Listede ara');
  const field=el('div','arcy-radar-search-field');
  const icon=el('span','arcy-radar-search-icon','⌕');icon.setAttribute('aria-hidden','true');
  const input=el('input','arcy-radar-search-input');
  input.type='search';input.id='arcyRadarSearchInput';input.autocomplete='off';input.spellcheck=false;input.maxLength=64;
  input.setAttribute('enterkeyhint','search');input.setAttribute('autocapitalize','off');
  input.placeholder='Token adı, sembol veya tam 0x kontrat adresi';
  label.htmlFor=input.id;
  const clear=el('button','arcy-radar-search-clear','×');clear.type='button';clear.hidden=true;clear.setAttribute('aria-label','Aramayı temizle');
  field.append(icon,input,clear);
  const status=el('p','arcy-radar-search-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
  const scope=el('p','arcy-radar-search-scope','Yalnızca seçili ağda Radar’ın şu an listelediği doğrulanmış adaylar içinde arar; yeni token keşfetmez ve sıralamayı değiştirmez.');
  box.append(label,field,status,scope);
  overview.before(box);
  let autoExpanded=null; // the network card this search expanded (collapsed again on clear)
  let applying=false;
  const visibleCard=()=>[...overview.querySelectorAll('.arcy-radar-overview-card')].find(c=>!c.hidden)||null;
  function restore(card){
   for(const row of overview.querySelectorAll('.arcy-radar-overview-token'))row.hidden=false;
   for(const n of overview.querySelectorAll('.arcy-radar-search-empty'))n.remove();
   if(card&&autoExpanded===card.dataset.overview&&card.classList.contains('is-expanded')){
    const action=card.querySelector('.arcy-radar-overview-action');autoExpanded=null;if(action&&!action.disabled)action.click();
   }else autoExpanded=null;
  }
  function apply(){
   if(applying)return;applying=true;
   try{
    const q=input.value,card=visibleCard();clear.hidden=!q;
    if(!card){status.hidden=true;return;}
    const net=card.dataset.overview,netName=NET_NAME[net]||net;
    if(!norm(q)){restore(card);status.hidden=true;return;}
    // search the network's full loaded list (up to its ten), not only the first five visible rows
    const action=card.querySelector('.arcy-radar-overview-action');
    if(!card.classList.contains('is-expanded')&&action&&!action.disabled&&/Tümünü/.test(action.textContent||'')){autoExpanded=net;action.click();}
    const rows=[...card.querySelectorAll('.arcy-radar-overview-token')];
    let shown=0,kind=null;const symbols=new Map();
    for(const row of rows){
     const info=rowInfo(row),m=matches(info,q);
     row.hidden=!m.match;
     if(m.match){shown++;kind=kind||m.kind;symbols.set(info.symbol,(symbols.get(info.symbol)||0)+1);}
     else if(m.kind==='PARTIAL_ADDRESS')kind='PARTIAL_ADDRESS';
    }
    for(const n of card.querySelectorAll('.arcy-radar-search-empty'))n.remove();
    status.hidden=false;
    if(shown){
     const dup=[...symbols.values()].some(v=>v>1);
     status.textContent=shown+' sonuç · '+netName+(dup?' · Aynı sembolü taşıyan birden fazla kontrat var; adresi kontrol edin.':'');
    }else{
     const msg=kind==='PARTIAL_ADDRESS'||norm(q).startsWith('0x')?
      'Kontrat aramasında yalnızca tam adres (0x ile başlayan 42 karakter) eşleşir. '+netName+' listesinde bu adrese sahip aday yok.':
      '“'+q.trim().slice(0,40)+'” '+netName+' listesindeki '+rows.length+' aday içinde bulunamadı. Arama başka ağlarda veya tüm zincirde yapılmaz; token Radar kriterlerini karşılamamış ya da bu güncellemede listede olmayabilir.';
     status.textContent='Sonuç yok';
     const empty=el('p','arcy-radar-search-empty',msg);
     card.querySelector('.arcy-radar-overview-list')?.append(empty);
    }
   }finally{applying=false;}
  }
  input.addEventListener('input',apply);
  input.addEventListener('search',apply);
  input.addEventListener('keydown',e=>{if(e.key==='Escape'&&input.value){input.value='';apply();}});
  clear.addEventListener('click',()=>{input.value='';apply();input.focus();});
  // keep the field and its results reachable above the on-screen keyboard on phones
  input.addEventListener('focus',()=>{if(window.matchMedia?.('(max-width: 767px)').matches)setTimeout(()=>box.scrollIntoView({block:'start',behavior:'smooth'}),250);});
  // the renderer rebuilds lists on refresh / network switch: re-apply the active query to the fresh rows
  // only renderer changes count: our own row.hidden toggles and the empty-result note are ignored (no feedback loop)
  const ours=n=>n.nodeType===1&&n.classList.contains('arcy-radar-search-empty');
  const relevant=m=>m.type==='attributes'?m.target.classList?.contains('arcy-radar-overview-card'):
   [...m.addedNodes,...m.removedNodes].some(n=>!ours(n));
  const observer=new MutationObserver(list=>{if(!applying&&norm(input.value)&&list.some(relevant))queueMicrotask(apply);});
  observer.observe(overview,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  panel.querySelector('.arcy-radar-networks')?.addEventListener('click',()=>setTimeout(apply,0));
 }
 function scan(){for(const p of document.querySelectorAll('.arcy-radar-panel'))mount(p);}
 if(NODE){if(typeof module==='object'&&module.exports)module.exports={matches,rowInfo,mount};return;}
 window.ARCYRadarSearch={matches,rowInfo,mount};
 scan();
 new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
