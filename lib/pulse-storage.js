const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const base=()=>process.env.ARC_PULSE_EDITION_DIR||path.join(process.env.ARC_HOLDER_PUBLISHED_DIR||path.join(__dirname,'../data/holder-snapshots'),'pulse-editions');
const editionFile=n=>path.join(base(),`pulse-${n}.json`),latestFile=()=>path.join(base(),'latest.json'),auditFile=()=>path.join(base(),'audit.json');
const key=()=>process.env.ARC_PULSE_SIGNING_KEY||process.env.ARC_HOLDER_SIGNING_KEY;
const publicKey=()=>process.env.ARC_PULSE_PUBLIC_KEY||process.env.ARC_HOLDER_PUBLIC_KEY||(key()?crypto.createPublicKey(key()):null);
function valid(d){return !!(d&&d.schemaVersion===1&&Number.isSafeInteger(d.number)&&d.number>0&&d.success===true&&['updated','quiet_week'].includes(d.status)&&Array.isArray(d.cards)&&d.cards.length===3&&typeof d.take==='string'&&d.take.length>0&&d.cards.every(c=>typeof c.title==='string'&&typeof c.url==='string'&&typeof c.publishedAt==='string')&&typeof d.generatedAt==='string');}
function envelope(edition){const payload=JSON.stringify(edition),signing=key();return signing?{payload,signature:crypto.sign(null,Buffer.from(payload),signing).toString('base64')}:{payload};}
function unpack(data){try{if(!data?.payload)return null;const verify=publicKey();if(data.signature&&(!verify||!crypto.verify(null,Buffer.from(data.payload),verify,Buffer.from(data.signature,'base64'))))return null;const edition=JSON.parse(data.payload);return valid(edition)?edition:null;}catch{return null;}}
async function write(file,data){await fs.mkdir(base(),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(data));await fs.rename(temp,file);}
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return null;}}
async function latest(){return unpack(await read(latestFile()));}
async function publish(edition){if(!valid(edition))throw Error('INVALID_PULSE_EDITION');const old=await latest(),oldEnvelope=await read(latestFile());if(old&&old.number>edition.number)throw Error('PULSE_EDITION_REGRESSION');const signed=envelope(edition);try{await write(editionFile(edition.number),signed);await write(latestFile(),signed);const previous=await audit();await write(auditFile(),{lastSuccessful:{number:edition.number,status:edition.status,generatedAt:edition.generatedAt,trigger:edition.trigger,cycle:edition.cycle},lastFailure:previous?.lastFailure||null});return edition;}catch(error){try{if(oldEnvelope)await write(latestFile(),oldEnvelope);else await fs.unlink(latestFile());}catch{}throw error;}}
async function failure(error,now=Date.now(),trigger='unknown'){const old=await audit();await write(auditFile(),{lastSuccessful:old?.lastSuccessful||null,lastFailure:{status:'failed',at:new Date(now).toISOString(),trigger,code:error?.code||'PULSE_REFRESH_FAILED'}});}
async function audit(){return await read(auditFile());}
module.exports={base,latest,publish,failure,audit,unpack,valid};
