'use strict';
// Standalone /radar entry. Reuses the exact existing approved Market Radar UI
// and provider-verification gate; never invents rankings or starts token scans.
(()=>{
 const root=document.getElementById('tokenDetail');
 const switcher=root?.querySelector('.arcy-radar-switcher');
 const entryStatus=document.getElementById('radarEntryStatus');
 if(!switcher||!entryStatus)return;
 const research=switcher.children[0],radar=switcher.children[1];
 // The regular token research tab requires an exact contract. Send visitors
 // to the actual Search instead of revealing an empty token report.
 research?.addEventListener('click',event=>{
  event.preventDefault();event.stopImmediatePropagation();
  window.location.assign('/#search');
 },{capture:true});
 let opened=false;
 const open=()=>{
  if(opened||radar?.disabled)return;
  opened=true;
  radar.click(); // The source gate has enabled the genuine button.
  entryStatus.hidden=true;
  observer.disconnect();
 };
 const observer=new MutationObserver(open);
 observer.observe(radar,{attributes:true,attributeFilter:['disabled']});
 open();
 setTimeout(()=>{
  if(!opened)entryStatus.textContent='Verified Radar data is temporarily unavailable. No unverified rankings are shown. Please try again later.';
 },11000);
})();
