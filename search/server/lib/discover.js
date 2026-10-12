'use strict';
const SEARCH=/^[\p{L}\p{N}\s.$_+\-&]{2,48}$/u;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
function normalizeQuery(raw){
 if(typeof raw!=='string')return null;
 const q=raw.normalize('NFKC').trim().replace(/\s+/g,' ');
 return SEARCH.test(q)&&!ADDRESS.test(q)?q:null;
}
async function discover(rawQuery){
 const q=normalizeQuery(rawQuery);
 if(!q)throw Error('Invalid discovery query');
 return [];
}
module.exports={normalizeQuery,parse:()=>[],discover};
