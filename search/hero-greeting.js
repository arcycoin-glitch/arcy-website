'use strict';
// Original ARCY greeting animation, with reduced-motion and constrained-network fallbacks.
// A frame from the official still image is always available, even if video never starts.
(()=>{
 const frame=document.querySelector('.hero-mascot');
 const video=frame?.querySelector('.hero-greeting-video');
 if(!frame||!video)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const canUseVideo=()=>!reduced.matches&&!document.hidden&&!navigator.connection?.saveData;
 let visible=false,ready=false,blocked=false;
 const fallback=()=>{frame.classList.remove('greeting-playing');video.pause()};
 const start=async()=>{
  if(!visible||!ready||blocked||!canUseVideo())return;
  if(!video.hasAttribute('src'))video.src=video.dataset.src;
  video.muted=true;
  try{await video.play()}catch{fallback()}
 };
 video.addEventListener('playing',()=>{
  if(!canUseVideo()){fallback();return}
  frame.classList.add('greeting-playing');
 });
 video.addEventListener('error',()=>{blocked=true;fallback()});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)fallback();else void start()});
 reduced.addEventListener('change',()=>{
  if(reduced.matches)fallback();
  else void start();
 });
 const observer=new IntersectionObserver(entries=>{
  visible=entries.some(entry=>entry.isIntersecting);
  if(!visible)fallback();
  else void start();
 },{threshold:0.05});
 observer.observe(frame);
 const init=()=>{ready=true;void start()};
 if('requestIdleCallback' in window)requestIdleCallback(init,{timeout:1800});
 else setTimeout(init,750);
})();
