'use strict';
(()=>{
 const scene=document.querySelector('#burn .burn-lab-scene');if(!scene)return;
 const video=scene.querySelector('video'),button=scene.querySelector('.burn-lab-play');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),connection=navigator.connection;
 let visible=false,failed=false,manual=false,timer;
 function asset(){const source=video.dataset.videoSrc;if(!source)return null;try{const url=new URL(source,location.href);return url.origin===location.origin&&url.pathname.startsWith('/assets/')&&/\.(mp4|webm)$/i.test(url.pathname)?url.href:null;}catch{return null;}}
 function fallback(){scene.classList.remove('is-playing');}
 function pause(){clearTimeout(timer);video.pause();fallback();}
 function update(){
  if(!asset()||reduced.matches){pause();button.hidden=true;return;}
  if(!visible||document.hidden){pause();button.hidden=true;return;}
  if(failed||(connection?.saveData&&!manual)){pause();button.hidden=false;return;}
  video.muted=true;video.defaultMuted=true;video.playsInline=true;
  if(!video.hasAttribute('src')){video.src=asset();video.load();}
  button.hidden=true;
  try{const playing=video.play();playing?.catch(()=>{fallback();if(visible&&!document.hidden&&!reduced.matches)button.hidden=false;});}catch{fallback();button.hidden=false;}
  clearTimeout(timer);timer=setTimeout(()=>{if(!scene.classList.contains('is-playing')&&visible&&!document.hidden&&!reduced.matches)button.hidden=false;},4000);
 }
 video.addEventListener('playing',()=>{clearTimeout(timer);if(!visible||document.hidden||reduced.matches){pause();return;}scene.classList.add('is-playing');button.hidden=true;});
 video.addEventListener('pause',fallback);video.addEventListener('ended',fallback);
 video.addEventListener('error',()=>{failed=true;pause();button.hidden=!visible||reduced.matches;});
 button.addEventListener('click',()=>{manual=true;failed=false;update();});
 if('IntersectionObserver'in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;update();},{threshold:.05}).observe(scene);
 else{visible=true;update();}
 document.addEventListener('visibilitychange',update);reduced.addEventListener('change',()=>{manual=false;update();});connection?.addEventListener?.('change',()=>{manual=false;update();});
})();
