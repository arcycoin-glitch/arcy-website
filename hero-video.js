'use strict';
(()=>{
 const video=document.querySelector('#hero .hero-video');
 if(!video)return;
 const frame=video.closest('.hero-flight');
 if(!frame)return;
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const saveData=()=>navigator.connection?.saveData===true;
 let visible=false,playing=false,failed=false,watchdog=null,button=null;
 const fallback=()=>{
  playing=false;frame.classList.remove('video-playing');
 };
 function control(){
  if(reduced.matches||failed||!visible)return;
  if(!button){
   button=document.createElement('button');
   button.type='button';
   button.className='hero-motion-toggle';
   button.textContent='▶ Animate owl';
   button.setAttribute('aria-label','Play the ARCY owl animation');
   button.addEventListener('click',()=>{
    button.hidden=true;
    failed=false;
    start(true);
   });
   frame.appendChild(button);
  }
  button.hidden=false;
 }
 function playResult(p){
  if(p&&typeof p.catch==='function')p.catch(()=>{
   if(!playing){fallback();control();}
  });
 }
 function start(userGesture=false){
  if(document.hidden||reduced.matches||!visible||failed)return;
  if(!userGesture&&saveData()){control();return;}
  // Initialize on visibility rather than waiting for all page assets. Large
  // homepage images must not postpone the mascot's first moving frame.
  if(!video.getAttribute('src')){
   video.preload='auto';
   video.src=video.dataset.src;
   video.load();
  }
  video.muted=true;video.defaultMuted=true;
  video.playsInline=true;
  video.setAttribute('playsinline','');
  try{playResult(video.play());}catch{fallback();control();}
  clearTimeout(watchdog);
  watchdog=setTimeout(()=>{if(!playing&&visible&&!document.hidden)control();},3500);
 }
 video.addEventListener('playing',()=>{
  playing=true;clearTimeout(watchdog);
  if(reduced.matches){video.pause();fallback();return;}
  frame.classList.add('video-playing');
  if(button)button.hidden=true;
 });
 video.addEventListener('error',()=>{failed=true;clearTimeout(watchdog);fallback();if(button)button.hidden=true;});
 video.addEventListener('pause',fallback);
 video.addEventListener('ended',fallback);
 video.addEventListener('stalled',()=>{if(!playing)fallback();});
 function visibility(inView){
  visible=inView;
  if(inView)start();
  else {video.pause();fallback();if(button)button.hidden=true;}
 }
 if('IntersectionObserver'in window){
  new IntersectionObserver(entries=>visibility(entries[0].isIntersecting),
   {threshold:0.01,rootMargin:'160px 0px 160px 0px'}).observe(frame);
 }else visibility(true);
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){video.pause();fallback();}
  else start();
 });
 window.addEventListener('pageshow',()=>start());
 reduced.addEventListener?.('change',()=>{
  if(reduced.matches){clearTimeout(watchdog);video.pause();fallback();if(button)button.hidden=true;}
  else start();
 });
})();
