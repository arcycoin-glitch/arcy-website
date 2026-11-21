#!/usr/bin/env node
'use strict';
// Read-only probe: why does mechanics report ARCHITECTURE_TARGET_UNRESOLVED for these Robinhood contracts? Prints code shape,
// standard proxy slots and the PUSH4 selector set (no source, no explorer).
const RPC='https://rpc.mainnet.chain.robinhood.com';
const SLOTS={eip1967Impl:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',eip1967Admin:'0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
 eip1967Beacon:'0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',eip1822:'0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',
 ozLegacyImpl:'0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',slot0:'0x0',slot1:'0x1'};
const rpc=async(method,params)=>{const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;};
function selectors(code){const b=Buffer.from(code.slice(2),'hex'),out=new Set();for(let i=0;i<b.length;i++){const op=b[i];if(op===0x63&&i+4<b.length)out.add('0x'+b.slice(i+1,i+5).toString('hex'));if(op>=0x60&&op<=0x7f)i+=op-0x5f;}return [...out];}
(async()=>{for(const a of process.argv.slice(2)){const code=await rpc('eth_getCode',[a,'latest']);const o={address:a,codeBytes:(code.length-2)/2,prefix:code.slice(0,140)};
 for(const [k,s] of Object.entries(SLOTS)){try{o[k]=await rpc('eth_getStorageAt',[a,s,'latest']);}catch(e){o[k]=e.message.slice(0,60);}}
 const sel=selectors(code);o.selectorCount=sel.length;o.selectors=sel.slice(0,80);
 for(const [n,d] of Object.entries({implementation:'0x5c60da1b',owner:'0x8da5cb5b',paused:'0x5c975abb',facets:'0x7a0ed627',facetAddress:'0xcdffacc6'})){try{o['call_'+n]=await rpc('eth_call',[{to:a,data:d},'latest']);}catch(e){o['call_'+n]='revert';}}
 console.log('MECHTARGET '+JSON.stringify(o));}})().catch(e=>{console.error(e);process.exitCode=1;});
