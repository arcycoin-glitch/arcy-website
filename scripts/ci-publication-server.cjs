#!/usr/bin/env node
'use strict';
// CI-only static HTTPS server for signed holder publications (Search accepts only https URLs without a port).
// Serves GET /snapshots/<path>.json from a directory; nothing else. Usage: node ci-publication-server.cjs <dir> <cert.pem> <key.pem>
const https=require('node:https'),fs=require('node:fs'),path=require('node:path');
const [dir,cert,key]=process.argv.slice(2);
https.createServer({cert:fs.readFileSync(cert),key:fs.readFileSync(key)},(req,res)=>{
 const m=/^\/snapshots\/((?:\d{1,7}\/)?0x[0-9a-f]{40}\.json)$/.exec(req.url||'');
 const file=m&&path.join(dir,m[1]);
 if(!m||!file.startsWith(path.resolve(dir)+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end('{}');}
 res.writeHead(200,{'content-type':'application/json'});res.end(fs.readFileSync(file));
}).listen(443,'127.0.0.1',()=>console.log('publication server on https://localhost/snapshots/'));
