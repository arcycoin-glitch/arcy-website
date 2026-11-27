#!/usr/bin/env node
'use strict';
// #335 / #77 read-only probe. Prints ONLY public issuer publication metadata needed to review an exact-contract
// circulating-supply mapping: currency identity, per-chain codes, amounts, update times, and the pinned
// totalSupply() of each candidate contract on its own chain. Writes nothing; no credentials are used.
const CANDIDATES=[
 {symbol:'USDC',network:'ethereum',chainId:1,rpc:['https://ethereum-rpc.publicnode.com','https://eth.llamarpc.com'],address:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',decimals:6},
 {symbol:'EURC',network:'ethereum',chainId:1,rpc:['https://ethereum-rpc.publicnode.com','https://eth.llamarpc.com'],address:'0x1abaea1f7c830bd89acc67ec4af516284b1bc33c',decimals:6}
];
async function rpc(urls,method,params){
 for(const u of urls){try{const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});const j=await r.json();if(j.result!==undefined)return {result:j.result,via:new URL(u).hostname};}catch{}}
 return {result:null,via:null};
}
const DOCS={USDC:'https://developers.circle.com/stablecoins/usdc-contract-addresses.md',EURC:'https://developers.circle.com/stablecoins/eurc-contract-addresses.md'};
const ARC_RPC=['https://rpc.mainnet.arc.io','https://rpc.blockdaemon.mainnet.arc.io'];
async function docRows(symbol){
 // Mainnet section only: everything before the first 'Testnet' heading.
 try{const r=await fetch(DOCS[symbol],{signal:AbortSignal.timeout(15000)});const text=await r.text();const main=text.split(/\n#+\s*Testnet/i)[0];
  const rows=main.split('\n').filter(l=>/^\|\s*(Arc|Ethereum)\s*\|/i.test(l)).map(l=>{const cells=l.split('|').map(x=>x.trim());const addr=(cells[2].match(/0x[0-9a-fA-F]{40}/)||[])[0]||null;return {chain:cells[1],address:addr};});
  console.log('CIRCLE_DOC '+JSON.stringify({symbol,status:r.status,url:DOCS[symbol],rows}));return rows;}catch(e){console.log('CIRCLE_DOC_FAILED',symbol,e.name);return [];}
}
(async()=>{
 for(const sym of ['USDC','EURC']){const rows=await docRows(sym);const arc=rows.filter(x=>/^arc$/i.test(x.chain)&&x.address);
  if(arc.length===1)CANDIDATES.push({symbol:sym,network:'arc',chainId:5042,rpc:ARC_RPC,address:arc[0].address.toLowerCase()});}
 const chain=await rpc(ARC_RPC,'eth_chainId',[]);console.log('ARC_CHAIN_ID',chain.result,chain.via);
 const t0=Date.now();let body=null,status=0;
 try{const r=await fetch('https://api.circle.com/v1/stablecoins',{signal:AbortSignal.timeout(15000)});status=r.status;body=await r.json();}catch(e){console.log('CIRCLE_FETCH_FAILED',e.name);}
 console.log('CIRCLE_STATUS',status,'ms',Date.now()-t0);
 for(const c of body?.data||[])console.log('CIRCLE_CURRENCY '+JSON.stringify({symbol:c.symbol,name:c.name,totalAmount:c.totalAmount??null,chains:(c.chains||[]).map(x=>({chain:x.chain,amount:x.amount,updateDate:x.updateDate}))}));
 for(const k of CANDIDATES){
  const block=await rpc(k.rpc,'eth_blockNumber',[]);
  const ts=block.result?await rpc(k.rpc,'eth_call',[{to:k.address,data:'0x18160ddd'},block.result]):{result:null};
  const sym=block.result?await rpc(k.rpc,'eth_call',[{to:k.address,data:'0x95d89b41'},block.result]):{result:null};
  const dec=block.result?await rpc(k.rpc,'eth_call',[{to:k.address,data:'0x313ce567'},block.result]):{result:null};
  (global.__probe||(global.__probe={}))[k.chainId+':'+k.address]={block:block.result,totalSupplyRaw:ts.result&&ts.result!=='0x'?BigInt(ts.result).toString():null};
  console.log('CANDIDATE '+JSON.stringify({symbol:k.symbol,chainId:k.chainId,address:k.address,block:block.result,via:block.via,
   totalSupplyRaw:ts.result&&ts.result!=='0x'?BigInt(ts.result).toString():null,decimals:dec.result&&dec.result!=='0x'?Number(BigInt(dec.result)):null,
   symbolAbi:sym.result&&sym.result.length>=194?Buffer.from(sym.result.slice(130),'hex').toString('utf8').replace(/\0+$/,''):null}));
 }
 // End-to-end: the production parser on live Circle data + the pinned totalSupply read above.
 const circle=require('../search/server/lib/circle-circulating'),units=(raw,d)=>{const r=String(raw).padStart(d+1,'0');return r.slice(0,-d)+'.'+r.slice(-d);};
 let ok=0;
 for(const k of CANDIDATES){
  const last=global.__probe?.[k.chainId+':'+k.address];if(!last)continue;
  const f=await circle.inspect(k.address,units(last.totalSupplyRaw,6),{network:k.network,chainId:k.chainId,block:last.block});
  if(f?.dataState==='DATA_FOUND')ok++;
  console.log('E2E '+JSON.stringify({symbol:k.symbol,chainId:k.chainId,address:k.address,dataState:f?.dataState,status:f?.status,value:f?.value,sourceAsOf:f?.evidence?.[0]?.sourceAsOf,issuerMinusRpcRaw:f?.evidence?.[0]?.issuerMinusRpcRaw,reasonCode:f?.reasonCode||null}));
 }
 const controls=[['ethereum',1,'0xdac17f958d2ee523a2206206994597c13d831ec7'],['arc',5042,'0x1abaea1f7c830bd89acc67ec4af516284b1bc33c'],['ethereum',1,'0x5a98fcbea516cf06857215779fd812ca3bef1b32']];
 for(const [network,chainId,address] of controls){const f=await circle.inspect(address,'1',{network,chainId,block:'0x1'});console.log('CONTROL '+JSON.stringify({network,address,result:f===null?'NOT_MAPPED_NO_FETCH':f.reasonCode}));}
 console.log('E2E_TOTAL '+JSON.stringify({mapped:CANDIDATES.length,dataFound:ok}));
})().catch(e=>{console.error(e.name);process.exitCode=1;});
