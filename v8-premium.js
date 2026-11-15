'use strict';
// Presentation only; article content, edition IDs, links and data are not rewritten.
(()=>{
 // Protect identifiers as text, without rewriting names, addresses or source data.
 for(const brand of document.querySelectorAll('.brand,#hero h1,.home-search-brand')){brand.lang='en';brand.setAttribute('translate','no');brand.classList.add('notranslate');}
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
 // Public evidence page: make it visible from the homepage without touching
 // the protected research DOM, article data, charts or animation assets.
 const links=document.getElementById('siteLinks');
 if(links&&!links.querySelector('a[href="/transparency.html"]')){
  const verify=document.createElement('a');
  verify.href='/transparency.html';
  verify.textContent='Verify';
  verify.setAttribute('aria-label','Transparency and Verification');
  const github=links.querySelector('.nav-github');
  links.insertBefore(verify,github||null);
 }
 const footerLinks=document.querySelector('.foot .social-icons');
 if(footerLinks&&!footerLinks.querySelector('a[href="/transparency.html"]')){
  const proof=document.createElement('a');
  proof.href='/transparency.html';
  proof.className='footer-source-link';
  proof.textContent='Transparency & Verification';
  footerLinks.append(proof);
 }
 // The former @Arcy_usdc handle is not an active support channel.
 document.querySelectorAll('a.social-icon[href="https://x.com/Arcy_usdc"]').forEach(link=>link.remove());
 // Keep the active ARCY Search profile visible beside the community link.
 if(footerLinks&&!footerLinks.querySelector('a[href="https://x.com/ARCYResearch"]')){
  const x=document.createElement('a');
  x.className='social-icon';
  x.href='https://x.com/ARCYResearch';
  x.target='_blank';
  x.rel='noopener noreferrer';
  x.setAttribute('aria-label','ARCY Search on X');
  x.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.77 7.73L23.2 22h-6.24l-4.89-6.4L6.46 22H3.35l7.24-8.27L2.95 2h6.4l4.42 5.84L18.9 2Zm-1.09 18.13h1.72L8.42 3.77H6.57l11.24 16.36Z"/></svg>';
  const telegram=footerLinks.querySelector('a[aria-label="Telegram"]');
  telegram?telegram.before(x):footerLinks.prepend(x);
 }
})();
