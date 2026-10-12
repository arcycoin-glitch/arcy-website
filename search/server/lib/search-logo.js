'use strict';
// Provider artwork is omitted until reuse terms are independently cleared.
// Callers keep their normal token identity and render the safe initials fallback.
async function contractLogo(){return null}
async function enhance(network,items){
 if(!Array.isArray(items))return [];
 return items.slice(0,12).map(item=>({...item,logoUrl:null,logoSource:null}));
}
module.exports={imageFromPairs:()=>null,contractLogo,enhance};
