'use strict';
function withTimeout(operation,ms,message='Operation timed out',{schedule=setTimeout,cancel=clearTimeout}={}){
 let timer;
 const timeout=new Promise((_,reject)=>{timer=schedule(()=>reject(new Error(message)),ms)});
 return Promise.race([Promise.resolve(operation),timeout]).finally(()=>{if(timer!==undefined)cancel(timer)});
}
module.exports={withTimeout};
