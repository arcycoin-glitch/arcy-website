'use strict';
/*
 * ARCY SEARCH metric explanations: presentation only.
 * No API calls, score calculations, schema mutations or layout rearrangement.
 */
(()=>{
 const glossary=Object.freeze({
  totalSupply:'Current supply reported by the token contract. This is not necessarily the amount available to trade.',
  nonBurnSupply:'Current supply minus balances at identified burn addresses. This is NOT independently verified circulating supply.',
  burnAddressBalance:'Tokens held at identified burn addresses. A balance here alone does not prove historical supply destruction.',
  burnAddressPct:'Share of current supply held at identified burn addresses. It does not establish a historical burn rate.',
  holderCount:'Number of holding addresses supported by the available evidence. One person can control several addresses.',
  largestWalletPct:'Share held by the largest observed address. A pool or exchange wallet may represent many users.',
  top10Pct:'Combined share held by the ten largest observed addresses. This includes the largest wallet; concentration does not prove common ownership.',
  top20Pct:'Combined share held by the twenty largest observed addresses, INCLUDING the top ten. It is not twenty additional wallets.',
  liquidityUsd:'Reported USD liquidity in matching pools returned by supported sources. It may not represent every pool in the market.',
  volume24h:'Trading volume reported for matched pools over the last 24 hours. This value also appears in the other market card; it is one underlying metric, not two independent checks.',
  dexPairCount:'Count of returned exchange and trading-pair records. This is not a guaranteed count of all markets.',
  liquidityTurnover24h:'Tracked 24-hour volume relative to tracked liquidity. It indicates activity versus pool depth, NOT how safely a large sale can exit.',
  priceUsd:'Reported USD token price from matched market evidence. Your actual execution price may differ.',
  valuation:'Market Cap uses a supported circulating supply; FDV uses total supply. The label tells you which estimate is available.',
  change24h:'Reported percentage price change over 24 hours, where a suitable source and window are available.',
  tradingTaxes:'Verified token-level buy or sell taxes, if detectable. Exchange fees and network gas are separate.',
  mintCapability:'Whether the contract may allow new tokens to be minted. NOT VERIFIED does not mean minting is disabled.',
  ownerAdmin:'Verified owner or administrative permissions that may affect the contract. An address is not necessarily one person.',
  contractArchitecture:'Identified contract structure and potential upgrade or proxy controls. Unknown architecture does not prove immutability.'
 });
 function init(){
  const root=document.getElementById('cards');
  if(!root)return;
  const definitions=Array.isArray(window.ARCYEthLabSchema)?window.ARCYEthLabSchema:[];
  const dialog=document.createElement('dialog');
  dialog.className='metric-glossary-dialog';
  dialog.setAttribute('aria-labelledby','metricGlossaryTitle');
  const title=document.createElement('h2');title.id='metricGlossaryTitle';
  const body=document.createElement('p');body.className='metric-glossary-copy';
  const footer=document.createElement('p');footer.className='metric-glossary-foot';
  footer.textContent='This explains the metric, not the safety of the token. Review its sources and verification state.';
  const close=document.createElement('button');close.type='button';close.className='metric-glossary-close';close.textContent='Close';
  close.addEventListener('click',()=>{if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');});
  dialog.append(title,body,footer,close);document.body.append(dialog);
  dialog.addEventListener('click',event=>{if(event.target===dialog&&typeof dialog.close==='function')dialog.close();});
  function decorate(){
   for(const card of root.querySelectorAll('[data-card-id]')){
    const spec=definitions.find(item=>item.id===card.dataset.cardId);
    if(!spec)continue;
    for(const row of card.querySelectorAll('.metric')){
     const label=row.querySelector(':scope > span');
     if(!label||label.querySelector('.metric-help'))continue;
     const displayed=label.textContent.trim();
     const match=spec.fields.find(([key,name])=>name===displayed||
      (key==='valuation'&&['Valuation','Market Cap','FDV'].includes(displayed)));
     if(!match||!glossary[match[0]])continue;
     const button=document.createElement('button');
     button.type='button';button.className='metric-help';button.textContent='ⓘ';
     button.setAttribute('aria-label','Explain '+displayed);
     button.setAttribute('aria-haspopup','dialog');
     button.setAttribute('title','What does '+displayed+' mean?');
     button.dataset.metricKey=match[0];
     button.addEventListener('click',()=>{
      title.textContent=displayed;
      body.textContent=glossary[match[0]];
      if(dialog.open&&typeof dialog.close==='function')dialog.close();
      if(typeof dialog.showModal==='function')dialog.showModal();
      else dialog.setAttribute('open','');
      close.focus();
     });
     label.append(button);
    }
   }
  }
  new MutationObserver(decorate).observe(root,{childList:true,subtree:true});
  decorate();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
