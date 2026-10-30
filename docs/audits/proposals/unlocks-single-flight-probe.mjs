let calls=0;
globalThis.fetch=async u=>{u=String(u);if(u.includes('coinbell')){calls++;await new Promise(r=>setTimeout(r,20));return {ok:false,text:async()=>''};}return {ok:false,json:async()=>({})};};
const m=await import(process.argv[2]);
const mk=()=>({setHeader(){},status(c){this.c=c;return this;},json(b){this.b=b;return this;}});
await Promise.all([1,2,3,4,5].map(()=>m.default({query:{},headers:{},url:'/api/unlocks'},mk())));
console.log(process.argv[3],'CoinBell GETs for 5 concurrent cold requests:',calls);
