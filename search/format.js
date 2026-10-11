(function(root,factory){
 'use strict';
 const formatter=factory();
 if(typeof module==='object'&&module.exports)module.exports=formatter;
 else root.ARCYMetricFormat=formatter;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const NUMERIC=/^([+-]?)(\d+)(?:\.(\d+))?$/;
 const SUFFIXES=[{power:3,suffix:'K'},{power:6,suffix:'M'},
  {power:9,suffix:'B'},{power:12,suffix:'T'},{power:15,suffix:'Q'}];
 const isPercent=key=>/^(change24h|largestWalletPct|top10Pct|top20Pct|burnAddressPct)$/.test(key);
 const isUsd=key=>/^(liquidityUsd|volume24h|valuation|priceUsd)$/.test(key);
 const label=kind=>kind==='MARKET_CAP'?'Market Cap ':kind==='FDV'?'FDV ':kind?kind+' ':'';
 function parseNumeric(value){
  if(typeof value!=='number'&&typeof value!=='string')return null;
  if(typeof value==='number'&&!Number.isFinite(value))return null;
  let raw=String(value).trim();
  // Expand scientific notation without rounding away tiny non-zero values.
  // Display-only: the original unmodified evidence object remains available.
  if(!NUMERIC.test(raw)&&typeof value==='number'){
   const m=/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(raw);
   if(m){
    const digits=m[2]+(m[3]||'');
    const position=m[2].length+Number(m[4]);
    if(position>0&&position<400)
     raw=m[1]+(position>=digits.length?digits+'0'.repeat(position-digits.length):
      digits.slice(0,position)+'.'+digits.slice(position));
    else if(position<=0&&position>-400)
     raw=m[1]+'0.'+'0'.repeat(-position)+digits;
   }
  }
  const match=NUMERIC.exec(raw);
  return match?{negative:match[1]==='-',whole:match[2].replace(/^0+(?=\d)/,''),fraction:match[3]||'',raw}:null;
 }
 function fullNumeric(value){
  const n=parseNumeric(value);
  if(!n)return String(value);
  const sign=n.negative&&!(n.whole==='0'&&!/[1-9]/.test(n.fraction))?'-':'';
  return sign+n.whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+
   (n.fraction?'.'+n.fraction:'');
 }
 function isZero(n){return n.whole==='0'&&!/[1-9]/.test(n.fraction)}
 // Round decimal strings without lossy floating-point conversion.
 function fixed(whole,fraction,places){
  const digits=whole+(places?fraction.padEnd(places,'0').slice(0,places):'');
  const next=fraction[places]||'0';
  const v=BigInt(digits||'0')+(next>='5'?1n:0n);
  const text=v.toString().padStart(places+1,'0');
  return places?{whole:text.slice(0,-places),fraction:text.slice(-places).replace(/0+$/,'')}:
   {whole:text,fraction:''};
 }
 function scientific(n){
  const stripped=n.whole==='0'?n.fraction.replace(/^0+/,''):n.whole+n.fraction;
  const leading=n.fraction.length-n.fraction.replace(/^0+/,'').length;
  let exponent=n.whole==='0'?-leading-1:n.whole.length-1;
  let significant=BigInt(stripped.slice(0,4).padEnd(4,'0'))+
   ((stripped[4]||'0')>='5'?1n:0n);
  if(significant===10000n){significant=1000n;exponent++}
  const digits=significant.toString().padStart(4,'0');
  const fraction=digits.slice(1).replace(/0+$/,'');
  return digits[0]+(fraction?'.'+fraction:'')+'e'+(exponent>=0?'+':'')+exponent;
 }
 const UNIT_STEPS=[[21,'Sx'],[18,'Qi'],[15,'Q'],[12,'T'],[9,'B'],[6,'M'],[3,'K']];
 function compactNumeric(value){
  const n=parseNumeric(value);
  if(!n)return null;
  if(isZero(n))return '0';
  const sign=n.negative?'-':'';
  const leading=n.fraction.length-n.fraction.replace(/^0+/,'').length;
  const exponent=n.whole==='0'?-leading-1:n.whole.length-1;
  if(exponent>=24||exponent< -4)return sign+scientific(n);
  for(let i=0;i<UNIT_STEPS.length;i++){
   const [power,suffix]=UNIT_STEPS[i];
   if(n.whole.length<=power)continue;
   const whole=n.whole.slice(0,-power);
   const fraction=n.whole.slice(-power)+n.fraction;
   const decimals=Math.min(4,Math.max(0,4-whole.length));
   const out=fixed(whole,fraction,decimals);
   if(out.whole.length>=4){
    if(i===0)return sign+scientific(n);
    return sign+'1'+UNIT_STEPS[i-1][1];
   }
   return sign+out.whole+(out.fraction?'.'+out.fraction:'')+suffix;
  }
  const decimals=Math.min(4,Math.max(0,4-(n.whole==='0'?0:n.whole.length)));
  const out=fixed(n.whole,n.fraction,decimals);
  if(out.whole.length>=4)return sign+'1K';
  return sign+out.whole+(out.fraction?'.'+out.fraction:'');
 }
 // Price is the one metric where users need more precision than K/M/B
 // summaries. Show four significant digits in normal decimal notation:
 // 0.00032632 -> $0.0003263, not $0.0003 or scientific e-notation.
 // This is display-only. full() preserves raw source precision.
 function readablePrice(value){
  const n=parseNumeric(value);
  if(!n)return null;
  if(isZero(n))return '0';
  const leading=n.fraction.length-n.fraction.replace(/^0+/,'').length;
  const exponent=n.whole==='0'?-leading-1:n.whole.length-1;
  if(exponent>=3||exponent< -14)return compactNumeric(value);
  const places=Math.max(0,3-exponent);
  const out=fixed(n.whole,n.fraction,Math.min(places,20));
  return (n.negative?'-':'')+out.whole+(out.fraction?'.'+out.fraction:'');
 }
 function display(value,key,kind){
  if(typeof value==='boolean')return value?'TRUE':'FALSE';
  const prefix=label(kind);
  if(key==='dexPairCount'){
   const counts=/^(\d+) DEX · (\d+) pairs$/.exec(String(value));
   if(counts)return compactNumeric(counts[1])+' DEX · '+compactNumeric(counts[2])+' pairs';
  }
  const shown=key==='priceUsd'?readablePrice(value):compactNumeric(value);
  if(shown===null)return prefix+String(value);
  return prefix+(isUsd(key)?(shown.startsWith('-')?'-$'+shown.slice(1):'$'+shown):shown)+(isPercent(key)?'%':'');
 }
 function full(value,key,kind){
  if(typeof value==='boolean')return value?'TRUE':'FALSE';
  const prefix=label(kind),numeric=parseNumeric(value);
  if(!numeric)return prefix+String(value);
  const shown=fullNumeric(value);
  return prefix+(isUsd(key)?(shown.startsWith('-')?'-'+String.fromCharCode(36)+shown.slice(1):String.fromCharCode(36)+shown):shown)+(isPercent(key)?'%':'');
 }
 return Object.freeze({display,full,compactNumeric});
});
