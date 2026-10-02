// Request-local deadlines apply only to scheduled holder work. Ordinary scans are unchanged.
const {AsyncLocalStorage}=require('node:async_hooks'),scope=new AsyncLocalStorage();
const exhausted=()=>Object.assign(Error('Holder worker time slice exhausted'),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});
function remaining(){return scope.getStore()?Math.max(0,scope.getStore().end-Date.now()):Infinity;}
function check(){if(remaining()<=0)throw exhausted();}
function operation(fn){const ms=remaining();if(ms===Infinity)return fn();if(ms<=0)return Promise.reject(exhausted());let timer;return Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(exhausted()),ms);})]).finally(()=>clearTimeout(timer));}
function run(ms,fn){return scope.run({end:Date.now()+Math.max(1,ms)},fn);}
function cleanup(fn){return scope.getStore()?run(1000,fn):fn();}
function facade(core,methods){return {...core,...Object.fromEntries(methods.map(k=>[k,(...args)=>operation(()=>core[k](...args))]))};}
module.exports={remaining,check,operation,run,cleanup,facade};
