'use strict';
// English interface labels only; article content, edition IDs, links and data are not rewritten.
(()=>{
 const pulse=document.getElementById('pulse');if(!pulse)return;
 const labels={ 'pulse-week':'🔥 THIS WEEK','pulse-new':'🆕 NEW','pulse-unlock':"🔓 WHAT'S UNLOCKING?" };
 function localizeCategories(){for(const card of pulse.querySelectorAll('.pulse-card')){const key=Object.keys(labels).find(name=>card.classList.contains(name)),label=card.querySelector(':scope > span');if(key&&label&&label.textContent!==labels[key])label.textContent=labels[key];}}
 const ethereum=pulse.querySelector('#pulse-panel-ethereum .head h3');
 if(ethereum){const y=document.createElement('span');y.className='arcy-wordmark-y';y.textContent='Y';const satellite=document.createElement('span');satellite.className='v8-pulse-satellite';satellite.setAttribute('aria-hidden','true');satellite.textContent='📡';ethereum.replaceChildren(document.createTextNode('ARC'),y,document.createTextNode(' ETH PULSE '),satellite);}
 const robinhood=pulse.querySelector('#pulse-panel-robinhood .head h3');
 if(robinhood){const satellite=document.createElement('span');satellite.className='v8-pulse-satellite';satellite.setAttribute('aria-hidden','true');satellite.textContent='📡';robinhood.append(document.createTextNode(' '),satellite);}
 localizeCategories();
 new MutationObserver(localizeCategories).observe(pulse,{childList:true,subtree:true,characterData:true});
})();
