'use strict';
(()=>{
 const hero=document.getElementById('hero'),motion=matchMedia('(prefers-reduced-motion: reduce)');
 if(!hero||motion.matches||document.hidden||(location.hash&&location.hash!=='#hero'))return;
 hero.classList.add('hero-welcome');
 let timer=setTimeout(finish,3100);
 function finish(){clearTimeout(timer);hero.classList.remove('hero-welcome');document.removeEventListener('visibilitychange',hidden);}
 function hidden(){if(document.hidden)finish();}
 hero.addEventListener('focusin',finish,{once:true});hero.addEventListener('pointerdown',finish,{once:true});
 document.addEventListener('visibilitychange',hidden);motion.addEventListener('change',()=>{if(motion.matches)finish();});
})();
