'use strict';
(()=>{
 const section=document.querySelector('main > #search');
 const header=section?.querySelector('.header');
 if(!section||!header||section.querySelector('.home-search'))return;

 const networks=[['arc','Arc','ARC'],['ethereum','Ethereum','ETH'],['robinhood','Robinhood Chain','RH']];
 const NETWORK_MARKUP=Object.freeze({arc:'A',ethereum:'Ξ',robinhood:'RH'});
 const setMark=(el,id)=>{el.textContent=NETWORK_MARKUP[id]||'?';el.dataset.network=id;};
 const app=document.createElement('section');app.className='home-search';app.setAttribute('aria-label','ARCY Search token discovery');
 const brand=document.createElement('div');brand.className='home-search-brand notranslate';brand.setAttribute('aria-label','ARCY SEARCH');brand.setAttribute('translate','no');
 const wordmark=document.createElement('div');wordmark.className='home-search-wordmark';
 const arcy=document.createElement('span');arcy.className='home-search-arcy';arcy.append(document.createTextNode('ARC'));const y=document.createElement('span');y.className='home-search-y';y.textContent='Y';arcy.append(y);
 const searchBrand=document.createElement('span');searchBrand.className='home-search-search';searchBrand.textContent='SEARCH';wordmark.append(arcy,searchBrand);brand.append(wordmark);
 const intro=document.createElement('p');intro.className='home-search-intro';intro.textContent='Multichain token research. Search a name, ticker, or exact contract.';
 const picker=document.createElement('div');picker.className='home-network-picker';picker.id='homeNetworkPicker';
 const pickerLabel=document.createElement('span');pickerLabel.className='home-field-label';pickerLabel.textContent='NETWORK';
 const trigger=document.createElement('button');trigger.type='button';trigger.className='home-network-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','homeNetworkMenu');
 const mark=document.createElement('span');mark.className='home-network-mark';mark.setAttribute('aria-hidden','true');
 const networkName=document.createElement('span');networkName.className='home-network-name';
 const chevron=document.createElement('span');chevron.className='home-network-chevron';chevron.setAttribute('aria-hidden','true');chevron.textContent='⌄';trigger.append(mark,networkName,chevron);
 const menu=document.createElement('div');menu.id='homeNetworkMenu';menu.className='home-network-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label','Token network');menu.hidden=true;
 let selected='arc';
 const options=new Map();
 function setNetwork(id,focus=false){selected=id;const [,label,monogram]=networks.find(x=>x[0]===id);networkName.textContent=label;setMark(mark,id);
  for(const [key,button] of options)button.setAttribute('aria-selected',String(key===id));
  menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
 for(const [id,label,monogram] of networks){const option=document.createElement('button');option.type='button';option.className='home-network-option';option.setAttribute('role','option');option.dataset.network=id;option.setAttribute('aria-selected','false');const badge=document.createElement('span');badge.className='home-network-mark';setMark(badge,id);const text=document.createElement('span');text.textContent=label;option.append(badge,text);option.addEventListener('click',()=>setNetwork(id,true));option.addEventListener('keydown',event=>{
   const items=[...options.values()],index=items.indexOf(option);let next=null;
   if(event.key==='ArrowDown')next=items[(index+1)%items.length];if(event.key==='ArrowUp')next=items[(index+items.length-1)%items.length];
   if(event.key==='Home')next=items[0];if(event.key==='End')next=items.at(-1);
   if(event.key==='Escape'){menu.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();event.preventDefault();return}
   if(next){event.preventDefault();next.focus()}
  });options.set(id,option);menu.append(option);}
 picker.append(pickerLabel,trigger,menu);setNetwork(selected);
 trigger.addEventListener('click',()=>{menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)options.get(selected).focus()});
 trigger.addEventListener('keydown',event=>{if(['ArrowDown','Enter',' '].includes(event.key)){event.preventDefault();menu.hidden=false;trigger.setAttribute('aria-expanded','true');options.get(selected).focus()}});
 document.addEventListener('pointerdown',event=>{if(!picker.contains(event.target)){menu.hidden=true;trigger.setAttribute('aria-expanded','false')}});

 const form=document.createElement('form');form.className='home-search-form';form.noValidate=true;
 const inputWrap=document.createElement('label');inputWrap.className='home-search-input-wrap';inputWrap.htmlFor='homeSearchQuery';
 const glass=document.createElement('span');glass.className='home-search-glass';glass.setAttribute('aria-hidden','true');glass.textContent='⌕';
 const input=document.createElement('input');input.id='homeSearchQuery';input.name='q';input.type='search';input.autocomplete='off';input.spellcheck=false;input.maxLength=48;input.placeholder='Token name, ticker or 0x contract address';input.setAttribute('aria-label','Token name, ticker or contract address');inputWrap.append(glass,input);
 const submit=document.createElement('button');submit.type='submit';submit.className='home-search-submit';submit.textContent='SEARCH / SCAN';form.append(inputWrap,submit);
 const state=document.createElement('p');state.className='home-search-state';state.id='homeSearchState';state.setAttribute('role','status');state.setAttribute('aria-live','polite');state.textContent='Exact contracts, source-backed candidates and 20 research checks.';
 const results=document.createElement('div');results.className='home-search-results';results.hidden=true;results.setAttribute('aria-label','Matching tokens');

 const attribution=document.createElement('p');attribution.className='home-search-attribution home-market-pending';attribution.append(document.createTextNode('Market data pending commercial-use verification. Token discovery powered by '));const explorerCredit=document.createElement('a');explorerCredit.href='https://blockscout.com';explorerCredit.target='_blank';explorerCredit.rel='noopener noreferrer';explorerCredit.textContent='Blockscout';attribution.append(explorerCredit,document.createTextNode('. Contract and source-backed on-chain checks remain available.'));
 const robinhoodNotice=document.createElement('p');robinhoodNotice.className='home-search-disclaimer';robinhoodNotice.textContent='Independent research tool. Not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.';
 app.append(brand,intro,picker,form,state,results,attribution,robinhoodNotice);header.after(app);
 document.documentElement.classList.add('search-upgraded');
 document.querySelectorAll('a[href="#search"]').forEach(link=>link.setAttribute('href','#search'));

 const addressPattern=/^0x[0-9a-fA-F]{40}$/;
 function detailPath(network,address){return '/search/token/'+network+'/'+address.toLowerCase()}
 function addCandidate(candidate,network){
  const button=document.createElement('a');button.className='home-search-result';button.href=detailPath(network,candidate.address);
  const logoHost=null;
  // ALWAYS keep a readable token-symbol fallback under remote artwork.
  // Failed or blocked provider images must not leave a blank logo box.
  const placeholder=document.createElement('span');placeholder.className='home-token-logo home-token-placeholder';
  placeholder.textContent=String(candidate.symbol||'?').slice(0,2).toUpperCase();
  placeholder.setAttribute('aria-hidden','true');
  if(logoHost){
   const image=document.createElement('img');image.src=logoHost;image.alt='';
   image.loading='lazy';image.referrerPolicy='no-referrer';image.decoding='async';
   image.addEventListener('error',()=>image.remove(),{once:true});placeholder.append(image);
  }
  const copy=document.createElement('span');copy.className='home-result-copy';
  const name=document.createElement('strong');name.textContent=String(candidate.name||'Unknown token').slice(0,90);
  const meta=document.createElement('span');meta.textContent=(candidate.symbol?String(candidate.symbol).slice(0,30)+' · ':'')+networks.find(x=>x[0]===network)[1]+' · '+String(candidate.source||'indexed candidate').slice(0,45);
  copy.append(name,meta);
  const id=candidate.identity&&typeof candidate.identity==='object'?candidate.identity:null;
  const status=document.createElement('span');status.className='home-result-status';
  // An aggregator catalog listing is NOT proof of the issuing project.
  // Registry matches are separately scoped from issuer-confirmed contracts.
  switch(id?.status){
   case 'OFFICIAL_CONTRACT_MATCHED':
    status.textContent='OFFICIAL CONTRACT';status.classList.add('official');break;
   case 'REGISTRY_MATCHED':
    status.textContent='REGISTRY MATCH';status.classList.add('registry');break;
   default:status.textContent='NOT VERIFIED';status.classList.add('unverified');
  }
  if(id?.status==='OFFICIAL_CONTRACT_MATCHED'&&id.issuer){
   const proof=document.createElement('small');proof.className='home-result-proof';
   proof.textContent='Issuer: '+String(id.issuer).slice(0,55)+' · exact network + contract';
   if(typeof id.proofUrl==='string'&&id.proofUrl.startsWith('https://'))proof.title='First-party contract source: '+id.proofUrl;
   copy.append(proof);
  }
  const address=document.createElement('code');address.textContent=candidate.address;
  button.append(placeholder,copy,address,status);
  return button;
 }

 form.addEventListener('submit',async event=>{
  event.preventDefault();results.replaceChildren();results.hidden=true;const query=input.value.trim();
  if(!query){state.textContent='Enter a token name, symbol or full contract address.';input.focus();return}
  if(addressPattern.test(query)){location.assign(detailPath(selected,query));return}
  if(query.length<2||query.length>48){state.textContent='Enter at least 2 characters (maximum 48).';return}
  submit.disabled=true;input.disabled=true;state.textContent='Searching '+networks.find(x=>x[0]===selected)[1]+' sources…';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch('/api/search?action=discover&chain='+encodeURIComponent(selected)+'&q='+encodeURIComponent(query),{headers:{accept:'application/json'},signal:controller.signal,credentials:'same-origin'});
   const body=await response.json().catch(()=>null);
   if(!response.ok||!body||body.ok!==true||body.network!==selected||!Array.isArray(body.matches))throw Error(body?.reason||body?.error||'Search sources are temporarily unavailable.');
   if(!body.matches.length){state.textContent='No indexed '+networks.find(x=>x[0]===selected)[1]+' token matched. Explorer coverage can be incomplete; try the exact contract address.';return}
   for(const candidate of body.matches.slice(0,12)){
    if(!candidate||candidate.network!==selected||candidate.chainId!==({arc:5042,ethereum:1,robinhood:4663})[selected]||!addressPattern.test(candidate.address||''))continue;
    results.append(addCandidate(candidate,selected));
   }
   results.hidden=results.childElementCount===0;state.textContent=results.hidden?'No valid '+networks.find(x=>x[0]===selected)[1]+' candidates returned.':'Select a candidate to open its separate, exact-contract research page.'+(body.providerError?' Some discovery sources were unavailable.':'');
  }catch(error){state.textContent=error.name==='AbortError'?'Search timed out. Try again shortly.':'Search unavailable: '+String(error.message||'upstream error').slice(0,130)}
  finally{clearTimeout(timeout);submit.disabled=false;input.disabled=false}
 });
})();
