'use strict';
// Mechanics-only uint256 display formatting. Keep raw on-chain units as BigInt;
// Number(uint256) silently loses precision above 2^53 and can display a false cap.
function formatTokenUnits(value, decimals, maxFraction=2){
 const raw=typeof value==='bigint'?value:BigInt(value);
 if(raw<0n)throw RangeError('Token amount must be unsigned');
 if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw RangeError('Invalid token decimals');
 if(!Number.isInteger(maxFraction)||maxFraction<0||maxFraction>18)throw RangeError('Invalid fraction precision');
 const places=Math.min(decimals,maxFraction);
 const quantum=10n**BigInt(decimals-places);
 const rounded=(raw+quantum/2n)/quantum;
 const fractionScale=10n**BigInt(places);
 const whole=rounded/fractionScale;
 const fraction=places===0?'':(rounded%fractionScale).toString().padStart(places,'0').replace(/0+$/,'');
 const prettyWhole=whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
 // Never render a positive sub-display-unit value as exactly zero.
 if(raw>0n&&rounded===0n)return '<'+(places?'0.'+'0'.repeat(places-1)+'1':'1');
 return prettyWhole+(fraction?'.'+fraction:'');
}
module.exports={formatTokenUnits};
