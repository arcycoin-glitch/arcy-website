'use strict';
(()=>{
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 document.querySelectorAll('.visual:not(.hero-energy)').forEach(scene=>{
  if(scene.querySelector('.scene-specks'))return;
  const particles=document.createElement('div');
  particles.className='scene-specks';
  particles.setAttribute('aria-hidden','true');
  for(let n=0;n<6;n++){
   const p=document.createElement('i');p.style.setProperty('--n',n);
   particles.append(p);
  }
  scene.append(particles);
 });
 const burned=document.getElementById('burned');
 const burnScene=document.querySelector('#burn .visual');
 if(burned&&burnScene){
  let last=burned.textContent,timer;
  new MutationObserver(()=>{
   if(last===burned.textContent)return;
   last=burned.textContent;
   if(reduced.matches)return;
   burnScene.classList.add('energy-updated');
   clearTimeout(timer);
   timer=setTimeout(()=>burnScene.classList.remove('energy-updated'),1600);
  }).observe(burned,{childList:true,characterData:true,subtree:true});
 }
 const ids=['hero','search','burn','unlocks','pulse','buy'];
 const sections=ids.map(id=>document.getElementById(id)).filter(Boolean);
 if(!sections.length)return;
 const links=[...document.querySelectorAll('.nav .links a[href^="#"]')];
 const nav=document.querySelector('.nav');
 let scheduled=false;
 function highlight(){
  scheduled=false;
  const marker=window.innerHeight*.42;
  let active=sections[0];
  for(const section of sections){
   if(section.getBoundingClientRect().top<=marker)active=section;
  }
  for(const link of links){
   const yes=link.getAttribute('href')==='#'+active.id;
   link.classList.toggle('arcy-active',yes);
   if(yes)link.setAttribute('aria-current','location');
   else link.removeAttribute('aria-current');
  }
  if(nav){
   const total=Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
   nav.style.setProperty('--arcy-scroll',String(Math.min(1,Math.max(0,window.scrollY/total))));
  }
 }
 function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(highlight);
 }
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',schedule,{passive:true});
 window.addEventListener('hashchange',schedule);
 schedule();
 if(reduced.matches||!('IntersectionObserver'in window))return;
 const observer=new IntersectionObserver(entries=>{
  for(const entry of entries){
   if(!entry.isIntersecting)continue;
   entry.target.classList.add('arcy-section-arrived');
   observer.unobserve(entry.target);
  }
 },{rootMargin:'0px 0px -8% 0px',threshold:.08});
 for(const section of sections.slice(1))observer.observe(section);
})();
