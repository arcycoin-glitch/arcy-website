'use strict';
(()=>{ // Keep old DOM/cards intact for safety, replace only its *presentation*.
 const section=document.getElementById('search'),header=section?.querySelector('.header');
 if(!header||document.querySelector('.search-launch'))return;
 const showcase=document.createElement('div');showcase.className='search-launch';
 const kicker=document.createElement('div');kicker.className='launch-kicker';
 kicker.textContent='ARCY SEARCH · TOKEN INTELLIGENCE';
 const h=document.createElement('h2');h.textContent='Know what you are buying.';
 const p=document.createElement('p');
 p.textContent='Research tokens across Arc, Ethereum and Robinhood Chain. Source-backed analysis, contract identity and price history in one clean research view.';
 const networks=document.createElement('div');networks.className='launch-networks';
 for(const name of ['Arc','Ethereum','Robinhood Chain']){
  const label=document.createElement('span');label.textContent=name;networks.append(label);
 }
 const cta=document.createElement('a');cta.className='launch-button';cta.href='/search/';
 cta.textContent='OPEN ARCY SEARCH ↗';
 showcase.append(kicker,h,p,networks,cta);
 header.after(showcase);
 // Search navigation always enters the dedicated same-domain research app.
 document.querySelectorAll('a[href="#search"]').forEach(a=>{a.href='/search/'});
 document.documentElement.classList.add('search-upgraded');
})();
