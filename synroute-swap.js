(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else if(typeof document!=='undefined'){
    const mount=()=>api.mount(document,root);
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);
    else mount();
  }
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const URL='/api/synroute/quote',EXTERNAL='https://app.synthra.org/swap';
 const PAIRS=Object.freeze({
   base_eth_usdc:{label:'Base ETH → Base USDC',chainId:8453,destination:8453},
   robinhood_eth_base_usdc:{label:'Robinhood ETH → Base USDC',chainId:4663,destination:8453}
 });
 const CSS=[
 '.sr-overlay{position:fixed;inset:0;z-index:2147483010;display:flex;align-items:center;justify-content:center;background:#020911db;padding:12px;backdrop-filter:blur(6px)}',
 '.sr-overlay[hidden]{display:none}.sr-dialog{width:min(480px,100%);max-height:calc(100dvh - 24px);overflow:auto;border:1px solid #8162b9;border-radius:19px;background:linear-gradient(150deg,#161329,#091725);color:#f4f2ff;padding:clamp(17px,4vw,26px);box-shadow:0 20px 65px #0009;font:14px/1.5 system-ui,sans-serif}',
 '.sr-dialog h2{margin:0 0 8px;font-size:23px}.sr-dialog p{color:#abb1c9;margin:0 0 14px}.sr-dialog label{display:block;font-size:12px;font-weight:800;margin:13px 0 5px;color:#d5c7fc}',
 '.sr-dialog input,.sr-dialog select{display:block;width:100%;min-height:44px;background:#081624;border:1px solid #5e5087;color:#fff;border-radius:10px;padding:10px;font:inherit}',
 '.sr-controls{display:flex;gap:8px;flex-wrap:wrap;margin:17px 0}.sr-dialog button{min-height:43px;border:1px solid #8970c8;background:#42326c;border-radius:10px;padding:9px 13px;color:#fff;font:inherit;font-weight:800;cursor:pointer}',
 '.sr-dialog button:disabled{opacity:.5;cursor:default}.sr-dialog button:focus-visible,.sr-dialog a:focus-visible{outline:2px solid #e5c6ff;outline-offset:3px}',
 '.sr-dialog button.sr-primary{background:#8b56de;border-color:#a17bec}.sr-dialog button.sr-close{margin-left:auto;background:#151928}.sr-status{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:12px;color:#c0cce3}',
 '.sr-details[hidden]{display:none}.sr-details{padding:13px;background:#0c1a2e;border:1px solid #465177;border-radius:11px;margin:10px 0}.sr-details p{margin:5px 0;color:#d9e0f2}.sr-address{font-size:11px;word-break:break-all;color:#d2bdff}',
 '.sr-dialog a{color:#d3b8ff;text-decoration:underline}.sr-note{font-size:11px;line-height:1.6;margin-top:12px;color:#9ba6bd}',
 '#buy .synroute-launch{display:block;width:100%;min-height:46px;margin-top:10px;border-radius:12px;border:1px solid rgba(165,134,221,.35);background:#251d3b;color:#ddd0ff;font-weight:800;cursor:pointer}',
 '#buy .synroute-launch:hover{background:#3d2c61}#buy .synroute-launch:focus-visible{outline:2px solid #cdb2ff;outline-offset:3px}',
 '@media(max-width:480px){.sr-controls{flex-direction:column}.sr-controls button{width:100%}.sr-dialog button.sr-close{margin-left:0}}'
 ].join('');
 function message(e){return String(e&&e.message||e||'Unavailable').slice(0,200);}
 function address(v){return typeof v==='string'&&/^0x[a-fA-F0-9]{40}$/.test(v);}
 function same(a,b){return String(a).toLowerCase()===String(b).toLowerCase();}
 function el(doc,tag,cls,text){const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
 function mount(doc,win){
  const original=doc.querySelector('#buy [data-synthra-open]');
  if(!original||doc.querySelector('[data-synroute-modal]'))return;
  // Mount only inside the existing Synthra card; the protected index.html is immutable.
  const launcher=el(doc,'button','btn synroute-launch','Swap here with SynRoute ↗');
  launcher.type='button';launcher.setAttribute('data-synroute-launch','');launcher.setAttribute('aria-haspopup','dialog');
  original.insertAdjacentElement('afterend',launcher);
  const footNote=doc.querySelector('#buy .syn-footnote');
  if(footNote?.lastChild?.nodeType===3) footNote.lastChild.textContent='Non-custodial · Connect a wallet only by choice';
  // Correct the external-only wording without altering the protected HTML or CSS layout.
  const description=doc.querySelector('#buy .syn-copy');
  if(description)description.textContent='Open Synthra directly or trade via SynRoute here. You authorize trades in your wallet; ARCY SEARCH never holds your funds.';
  const style=el(doc,'style');style.textContent=CSS;doc.head.appendChild(style);
  const overlay=el(doc,'div','sr-overlay');overlay.hidden=true;overlay.setAttribute('data-synroute-modal','');
  const modal=el(doc,'section','sr-dialog');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','sr-title');
  const title=el(doc,'h2','','Swap with SynRoute');title.id='sr-title';
  const intro=el(doc,'p','','Non-custodial swap: connect a wallet, review a live quote and sign the transaction yourself.');
  const lblPair=el(doc,'label','','Trade route');lblPair.htmlFor='sr-pair';
  const pair=el(doc,'select');pair.id='sr-pair';
  for(const [id,item] of Object.entries(PAIRS)){const op=el(doc,'option','',item.label);op.value=id;pair.appendChild(op);}
  const lblAmount=el(doc,'label','','ETH amount (0.001–1)');lblAmount.htmlFor='sr-amount';
  const amount=el(doc,'input');amount.id='sr-amount';amount.type='text';amount.inputMode='decimal';amount.placeholder='0.01';amount.autocomplete='off';amount.maxLength=24;
  const actions=el(doc,'div','sr-controls');
  const connect=el(doc,'button','','Connect wallet'),preview=el(doc,'button','sr-primary','Get live quote'),closeBtn=el(doc,'button','sr-close','Close');
  for(const btn of [connect,preview,closeBtn])btn.type='button';
  preview.disabled=true;actions.append(connect,preview,closeBtn);
  const details=el(doc,'div','sr-details');details.hidden=true;
  const review=el(doc,'p'),minimum=el(doc,'p'),fee=el(doc,'p'),route=el(doc,'p'),expiry=el(doc,'p'),target=el(doc,'p','sr-address'),warn=el(doc,'p');
  const execute=el(doc,'button','sr-primary','Review & sign in wallet');execute.type='button';execute.disabled=true;
  details.append(review,minimum,fee,route,expiry,target,warn,execute);
  const status=el(doc,'div','sr-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const note=el(doc,'div','sr-note','ARCY token is unavailable before launch. You pay blockchain gas and assume trading, liquidity and settlement risks. ARCY SEARCH does not custody funds.');
  const external=el(doc,'a','','Open full Synthra app ↗');external.href=EXTERNAL;external.target='_blank';external.rel='noopener noreferrer';
  modal.append(title,intro,lblPair,pair,lblAmount,amount,actions,details,status,note,external);
  overlay.appendChild(modal);doc.body.appendChild(overlay);
  let wallet=null,provider=null,quote=null,busy=false,txHash=null;
  const setStatus=text=>{status.textContent=text;};
  const resetQuote=()=>{quote=null;details.hidden=true;execute.disabled=true;};
  const controls=()=>{connect.disabled=busy;preview.disabled=busy||!wallet;execute.disabled=busy||!quote;closeBtn.disabled=busy;amount.disabled=busy;pair.disabled=busy;};
  function open(){overlay.hidden=false;setStatus('Connect an EVM wallet. Nothing is sent without your signature.');connect.focus();}
  function close(){if(busy)return;overlay.hidden=true;launcher.focus();}
  launcher.disabled=false;launcher.addEventListener('click',open);closeBtn.addEventListener('click',close);
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
  doc.addEventListener('keydown',e=>{if(!overlay.hidden&&e.key==='Escape'){e.preventDefault();close();}});
  pair.addEventListener('change',resetQuote);amount.addEventListener('input',resetQuote);
  connect.addEventListener('click',async()=>{
   if(busy)return;
   provider=win.ethereum?.providers?.find(p=>typeof p.request==='function')||win.ethereum;
   if(!provider||typeof provider.request!=='function'){setStatus('No EVM wallet found. Open this website in MetaMask or an EVM wallet browser.');return;}
   busy=true;controls();resetQuote();
   try{
    const accounts=await provider.request({method:'eth_requestAccounts'});
    if(!Array.isArray(accounts)||!address(accounts[0]))throw Error('No EVM account returned');
    wallet=accounts[0];connect.textContent=wallet.slice(0,6)+'…'+wallet.slice(-4);
    setStatus('Wallet connected: '+wallet+'. No swap has been authorized.');
   }catch(e){wallet=null;setStatus('Wallet connection not completed: '+message(e));}
   finally{busy=false;controls();}
   if(provider.on&&!provider.__arcySynrouteBound){
    provider.__arcySynrouteBound=true;
    provider.on('accountsChanged',()=>{wallet=null;connect.textContent='Reconnect wallet';resetQuote();controls();setStatus('Account changed; reconnect.');});
    provider.on('chainChanged',()=>{resetQuote();setStatus('Network changed; request a new quote.');});
   }
  });
  preview.addEventListener('click',async()=>{
   if(!wallet||busy)return;
   const pairId=pair.value,amountText=amount.value.trim().replace(',','.');
   if(!/^(?:0|[1-9]\d?)(?:\.\d{1,18})?$/.test(amountText)){setStatus('Enter a valid ETH amount between 0.001 and 1.');return;}
   busy=true;resetQuote();controls();setStatus('Requesting a live route from Synthra…');
   try{
    const res=await win.fetch(URL,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({wallet,pairId,amount:amountText})});
    const v=await res.json();if(!res.ok||!v.ok)throw Error(v.code||'No route available');
    if(v.sourceChainId!==PAIRS[pairId].chainId||v.destinationChainId!==PAIRS[pairId].destination||!same(v.transaction?.from,wallet)||v.expiresAt<=Date.now())throw Error('Quote integrity check failed');
    quote=v;
    review.textContent='Sell '+v.amountIn+' ETH → ~'+v.estimatedOut+' USDC';
    minimum.textContent='Minimum received: '+v.minimumOut+' USDC · Slippage: '+v.slippageBps/100+'%';
    fee.textContent='Estimated network cost: '+(v.feeEstimateUsd===null?'check your wallet':'$'+Number(v.feeEstimateUsd).toFixed(3));
    route.textContent='Route: '+v.route+(v.revenueEligibleRoute?' (external)':' (Synthra internal)');
    expiry.textContent='Expires: '+new Date(v.expiresAt).toLocaleTimeString();
    target.textContent='Transaction destination (verify in wallet): '+v.transaction.to;
    warn.textContent=(v.warnings||[]).join(' · ');
    details.hidden=false;setStatus('Review amount, minimum, gas and contract. Only your wallet can authorize this trade.');
   }catch(e){setStatus('No executable quote: '+message(e)+'. The full Synthra app remains available.');}
   finally{busy=false;controls();}
  });
  execute.addEventListener('click',async()=>{
   if(!quote||busy||!wallet||!provider)return;
   const q=quote;if(q.expiresAt<=Date.now()){resetQuote();setStatus('Quote expired. Get a new quote.');return;}
   busy=true;controls();setStatus('Checking wallet and source chain. No transaction sent yet.');
   try{
    const accounts=await provider.request({method:'eth_accounts'});
    if(!Array.isArray(accounts)||!accounts.some(a=>same(a,wallet)))throw Error('Wallet account changed');
    const required='0x'+q.sourceChainId.toString(16);
    let chain=await provider.request({method:'eth_chainId'});
    if(chain.toLowerCase()!==required){await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:required}]});chain=await provider.request({method:'eth_chainId'});}
    if(chain.toLowerCase()!==required)throw Error('Wrong wallet network');
    if(q.expiresAt<=Date.now())throw Error('Quote expired before signing');
    if(!address(q.transaction.to)||!same(q.transaction.from,wallet)||q.transaction.chainId!==q.sourceChainId)throw Error('Transaction mismatch');
    const tx={from:wallet,to:q.transaction.to,data:q.transaction.data,value:'0x'+BigInt(q.transaction.value).toString(16)};
    setStatus('Review and approve in your wallet. Verify network, recipient, amount and gas.');
    txHash=await provider.request({method:'eth_sendTransaction',params:[tx]});
    if(!/^0x[0-9a-fA-F]{64}$/.test(txHash))throw Error('Invalid transaction hash');
    setStatus('Submitted '+txHash+'. Checking source-chain receipt. Do not resubmit.');
    let receipt=null;
    for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,5000));receipt=await provider.request({method:'eth_getTransactionReceipt',params:[txHash]});if(receipt)break;}
    if(!receipt){setStatus('Transaction submitted; receipt pending. Verify in wallet explorer: '+txHash);return;}
    if(receipt.status!=='0x1'){setStatus('Source-chain transaction failed or uncertain. Check transaction: '+txHash);return;}
    if(!q.requestId){setStatus('Source transaction confirmed. Verify final swap settlement in wallet or Synthra. Hash: '+txHash);return;}
    setStatus('Source transaction confirmed. Waiting for cross-chain settlement… '+txHash);
    for(let i=0;i<20;i++){
     await new Promise(resolve=>setTimeout(resolve,7000));
     try{
      const r=await win.fetch(URL+'?requestId='+encodeURIComponent(q.requestId),{cache:'no-store'});
      if(!r.ok)continue;const s=await r.json();
      if(s.state==='settled'&&s.destinationTxHash){setStatus('Destination settled! '+s.destinationTxHash);return;}
      if(s.state==='failed'){setStatus('Synthra reports failed/refunded. Check your source wallet and Synthra.');return;}
     }catch(_){}
    }
    setStatus('Source confirmed; final destination settlement still pending or unverified. Verify in Synthra. Source: '+txHash);
   }catch(e){setStatus((txHash?'Transaction status needs independent verification: ':'No transaction confirmed: ')+message(e)+(txHash?' · '+txHash:''));}
   finally{busy=false;resetQuote();controls();txHash=null;}
  });
 }
 return {PAIRS,URL,address,mount};
});