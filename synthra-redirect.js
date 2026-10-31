(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else if(typeof document!=='undefined'){const go=()=>api.mount(document,root);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();}
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 // External redirect only. ARCY SEARCH never executes swaps, connects wallets, calls trading APIs or asks for keys/signatures.
 // Destination: the general swap page of Synthra's official app (https://synthra.org links "Launch app" to https://app.synthra.org/; /swap is the app's Swap route).
 // No token/network is preselected: Synthra documents no URL parameters, and a live test with `inputCurrency`/`outputCurrency`
 // honoured the input only; an Arc output token (including a token Synthra lists) was NOT preselected. Never add undocumented parameters or a token address here.
 const SWAP_URL='https://app.synthra.org/swap';
 const LABEL='Swap on Synthra ↗';
 const TITLE='External Swap Notice';
 const TEXT=[
  'You are leaving ARCY SEARCH and entering Synthra, an independent third-party swap platform.',
  'ARCY SEARCH does not execute swaps, custody user funds, or provide investment advice. You are responsible for your trading decisions and associated market risks.',
  'Review all fees, permissions, transaction details and Synthra’s terms before proceeding.'
 ];
 const CSS='.syn-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(2,8,14,.78);backdrop-filter:blur(6px)}'+
  '.syn-overlay[hidden]{display:none}'+
  '.syn-dialog{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#091725;color:#f4fbff;border:1px solid #1e536d;border-radius:16px;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.55);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Arial,sans-serif}'+
  '.syn-dialog h2{margin:0 0 10px;font-size:20px}.syn-dialog p{margin:0 0 10px;color:#a9c1cf}'+
  '.syn-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px}'+
  '.syn-actions button,.syn-open{min-height:44px;padding:11px 18px;border-radius:12px;border:1px solid #1e536d;background:#0b2031;color:#f4fbff;font:inherit;font-weight:800;cursor:pointer}'+
  '.syn-actions button.syn-go{background:linear-gradient(135deg,#22d9ff,#4af4d5);color:#04121b;border-color:transparent}'+
  '.syn-actions button:focus-visible,.syn-open:focus-visible{outline:2px solid #22d9ff;outline-offset:3px}'+
  '@media(max-width:480px){.syn-actions{flex-direction:column-reverse}.syn-actions button{width:100%}}';
 function openExternal(win){
  // opener is severed by noopener; no referrer is sent. Returns the window handle (null when noopener is honoured).
  return win.open(SWAP_URL,'_blank','noopener,noreferrer');
 }
 function buildModal(doc){
  const overlay=doc.createElement('div');overlay.className='syn-overlay';overlay.hidden=true;overlay.setAttribute('data-synthra-modal','');
  const dlg=doc.createElement('div');dlg.className='syn-dialog';dlg.setAttribute('role','dialog');dlg.setAttribute('aria-modal','true');dlg.setAttribute('aria-labelledby','syn-title');dlg.setAttribute('aria-describedby','syn-desc');
  const h=doc.createElement('h2');h.id='syn-title';h.textContent=TITLE;
  const body=doc.createElement('div');body.id='syn-desc';for(const t of TEXT){const p=doc.createElement('p');p.textContent=t;body.appendChild(p);}
  const legal=doc.createElement('p');const a=doc.createElement('a');a.href='/legal.html';a.textContent='Legal & Disclaimer';a.style.color='#22d9ff';legal.appendChild(a);body.appendChild(legal);
  const row=doc.createElement('div');row.className='syn-actions';
  const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.setAttribute('data-synthra-cancel','');
  const go=doc.createElement('button');go.type='button';go.className='syn-go';go.textContent='Continue to Synthra';go.setAttribute('data-synthra-continue','');
  row.append(cancel,go);dlg.append(h,body,row);overlay.appendChild(dlg);
  return {overlay,dlg,cancel,go};
 }
 function mount(doc,win){
  if(doc.querySelector('[data-synthra-modal]'))return;
  const style=doc.createElement('style');style.textContent=CSS;doc.head.appendChild(style);
  const m=buildModal(doc);doc.body.appendChild(m.overlay);
  let opener=null;
  const focusables=()=>[m.cancel,m.go];
  function close(){m.overlay.hidden=true;doc.removeEventListener('keydown',onKey,true);if(opener&&opener.focus)opener.focus();opener=null;}
  function open(from){opener=from||null;m.overlay.hidden=false;doc.addEventListener('keydown',onKey,true);m.cancel.focus();}
  function onKey(e){
   if(e.key==='Escape'){e.preventDefault();close();return;}
   if(e.key==='Tab'){const f=focusables(),i=f.indexOf(doc.activeElement);e.preventDefault();f[(i+(e.shiftKey?-1:1)+f.length)%f.length].focus();}
  }
  m.cancel.addEventListener('click',close);
  m.overlay.addEventListener('click',e=>{if(e.target===m.overlay)close();});
  m.go.addEventListener('click',()=>{openExternal(win);close();});
  // Button: appended next to the existing community actions (no existing control is changed or removed).
  const actions=doc.querySelector('#buy .actions');
  if(actions){
   const b=doc.createElement('button');b.type='button';b.className='btn syn-open';b.textContent=LABEL;b.setAttribute('data-synthra-open','');
   b.setAttribute('aria-haspopup','dialog');b.addEventListener('click',()=>open(b));actions.appendChild(b);
  }
  const quick=doc.querySelector('.footer-quick-links');
  if(quick&&!quick.querySelector('a[href="/legal.html"]')){
   const l=doc.createElement('a');l.className='footer-source-link';l.href='/legal.html';l.textContent='Legal & Disclaimer';quick.appendChild(l);
  }
 }
 return {SWAP_URL,LABEL,TITLE,TEXT,mount,openExternal,buildModal};
});
