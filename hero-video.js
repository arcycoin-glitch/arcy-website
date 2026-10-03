'use strict';
(()=>{
 const video=document.querySelector('#hero .hero-video');if(!video)return;
 const frame=video.parentElement,motion=matchMedia('(prefers-reduced-motion: reduce)');
 let visible=false,ready=false,failed=false,timer;
 const fallback=()=>frame.classList.remove('video-playing');
 function start(){
  clearTimeout(timer);
  if(!ready||!visible||motion.matches||document.hidden||failed||navigator.connection?.saveData)return;
  // Do not compete with an active Search scan for network capacity.
  if(Number(document.getElementById('scan')?.dataset.pending)>0){timer=setTimeout(start,1000);return;}
  if(!video.hasAttribute('src'))video.src=video.dataset.src;
  video.muted=true;
  video.play()?.catch(fallback);
 }
 video.addEventListener('playing',()=>{if(motion.matches){video.pause();fallback();}else frame.classList.add('video-playing');});
 video.addEventListener('error',()=>{failed=true;fallback();});
 motion.addEventListener('change',()=>{if(motion.matches){clearTimeout(timer);video.pause();video.removeAttribute('src');video.load();fallback();}else start();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)video.pause();else start();});
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)start();else video.pause();},{threshold:0.05}).observe(frame);
 function idle(){const activate=()=>{ready=true;start();};if('requestIdleCallback'in window)requestIdleCallback(activate,{timeout:2000});else setTimeout(activate,1500);}
 if(document.readyState==='complete')idle();else window.addEventListener('load',idle,{once:true});
})();
