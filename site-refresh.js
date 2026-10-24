(function(){
 'use strict';
 // Refresh only while a visitor is actively viewing the page. Every fetch
 // uses the established source-backed endpoint/renderer; no cached figures,
 // artificial values or design changes are introduced here.
 const tasks=[
  {key:'burn',fn:'loadBurn',interval:2*60*1000},
  {key:'market',fn:'loadArcPrices',interval:3*60*1000},
  {key:'unlocks',fn:'loadUnlocks',interval:10*60*1000},
  {key:'pulse',fn:'loadPulse',interval:60*60*1000}
 ];
 const state=Object.fromEntries(tasks.map(t=>[t.key,{lastAttempt:Date.now(),pending:false}]));
 function eligible(){
  return document.visibilityState==='visible'&&
    (typeof navigator==='undefined'||navigator.onLine!==false);
 }
 function tick(now=Date.now()){
  if(!eligible())return;
  for(const task of tasks){
   const status=state[task.key];
   if(status.pending||now-status.lastAttempt<task.interval)continue;
   if(task.key==='pulse'&&new URLSearchParams(location.search).has('pulseEdition'))continue;
   const loader=window[task.fn];
   if(typeof loader!=='function')continue;
   status.pending=true;
   status.lastAttempt=now;
   Promise.resolve().then(()=>task.key==='unlocks'?loader({silent:true}):loader())
    .catch(()=>{ /* Source-backed existing loader owns unavailable/NOT VERIFIED UI. */ })
    .finally(()=>{status.pending=false});
  }
 }
 // The original inline scripts perform initial reads; this only retries and
 // refreshes later. Browsers may pause timers in background tabs.
 const timer=setInterval(()=>tick(),60*1000);
 document.addEventListener('visibilitychange',()=>{if(eligible())tick()});
 window.addEventListener('focus',()=>tick());
 window.addEventListener('pageshow',()=>tick());
 window.addEventListener('online',()=>tick());
 // Expose non-sensitive local scheduling state for diagnostics/test only.
 window.ARCY_AUTO_REFRESH=Object.freeze({
  check:tick,
  status:()=>Object.fromEntries(Object.entries(state).map(([key,value])=>
   [key,{lastAttempt:value.lastAttempt,pending:value.pending}])),
  timerActive:()=>Boolean(timer)
 });
})();
