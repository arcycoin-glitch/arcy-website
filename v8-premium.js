'use strict';
// Presentation only; article content, edition IDs, links and data are not rewritten.
(()=>{
 // Protect identifiers as text, without rewriting names, addresses or source data.
 for(const brand of document.querySelectorAll('.brand,#hero h1,.home-search-brand,#pulseTitle,.pulse-take>b,.pulse-chain-empty .head h3')){brand.lang='en';brand.setAttribute('translate','no');brand.classList.add('notranslate');}
 // Preserve the English interface of the approved research holograms when
 // browser page translation is enabled (the source copy is already English).
 document.querySelectorAll('#hero .v8-hologram').forEach(card=>{
  card.lang='en';
  card.translate=false;
  card.classList.add('notranslate');
  card.setAttribute('translate','no');
 });
 const factory=document.querySelector('.v8-burn-factory-art img');
 if(factory&&!navigator.connection?.saveData){const load=()=>{factory.addEventListener('load',()=>factory.closest('.burn-lab-scene').classList.add('v8-factory-ready'),{once:true});factory.src=factory.dataset.src;};if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load();}},{rootMargin:'120px'});observer.observe(factory.parentElement);}else load();}
 const pulse=document.getElementById('pulse');if(!pulse)return;
 const labels={ 'pulse-week':'🔥 THIS WEEK','pulse-new':'🆕 NEW','pulse-unlock':"🔓 WHAT'S UNLOCKING?" };
 // Reuse the same first-party network marks shown in the chain selector.
 // Arc cards can be replaced by an asynchronous Pulse refresh, so this is
 // idempotent and runs with the existing content observer.
 function ensureChainCardArt(){
  for(const [chain,mark,cls] of [
   ['arc','arc-network-mark.svg','v8-arc-card-art'],
   ['robinhood','robinhood-chain-mark.svg','v8-robinhood-card-art']
  ]){
   for(const card of pulse.querySelectorAll('#pulse-panel-'+chain+' .pulse-card')){
    if(card.querySelector('.'+cls))continue;
    const image=document.createElement('img');
    image.className=cls;
    image.src='/search/assets/'+mark;
    image.alt='';
    image.setAttribute('aria-hidden','true');
    image.loading='lazy';
    image.decoding='async';
    image.width=96;
    image.height=128;
    card.append(image);
   }
  }
 }
 function localizeCategories(){ensureChainCardArt();for(const card of pulse.querySelectorAll('.pulse-card')){const key=Object.keys(labels).find(name=>card.classList.contains(name)),label=card.querySelector(':scope > span');if(key&&label&&(label.textContent!==labels[key]||!label.querySelector('.v8-pulse-icon'))){const [symbol,...words]=labels[key].split(' '),icon=document.createElement('span');icon.className='v8-pulse-icon';icon.setAttribute('aria-hidden','true');icon.textContent=symbol;label.replaceChildren(icon,document.createTextNode(' '+words.join(' ')));}}}
 const arc=pulse.querySelector('#pulse-panel-arc');
 if(arc&&!arc.querySelector('.v8-pulse-owl')){const owl=document.createElement('img');owl.className='v8-pulse-owl';owl.src='/assets/burn-lab-poster.webp';owl.alt='';owl.setAttribute('aria-hidden','true');owl.loading='lazy';owl.decoding='async';owl.width=1400;owl.height=788;arc.prepend(owl);}
 const ethereum=pulse.querySelector('#pulse-panel-ethereum .head h3');
 if(ethereum){const y=document.createElement('span');y.className='arcy-wordmark-y';y.textContent='Y';const satellite=document.createElement('span');satellite.className='v8-pulse-satellite';satellite.setAttribute('aria-hidden','true');satellite.textContent='📡';ethereum.replaceChildren(document.createTextNode('ARC'),y,document.createTextNode(' ETH PULSE '),satellite);}
 const robinhood=pulse.querySelector('#pulse-panel-robinhood .head h3');
 if(robinhood){const satellite=document.createElement('span');satellite.className='v8-pulse-satellite';satellite.setAttribute('aria-hidden','true');satellite.textContent='📡';robinhood.append(document.createTextNode(' '),satellite);}
 for(const card of pulse.querySelectorAll('#pulse-panel-ethereum .pulse-card')){const image=document.createElement('img');image.className='v8-eth-card-art';image.src='/search/assets/ethereum-mark.svg';image.alt='';image.setAttribute('aria-hidden','true');image.loading='lazy';image.width=96;image.height=128;card.append(image);}
 localizeCategories();
 new MutationObserver(localizeCategories).observe(pulse,{childList:true,subtree:true,characterData:true});
})();
