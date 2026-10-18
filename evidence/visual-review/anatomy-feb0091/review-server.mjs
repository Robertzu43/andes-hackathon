import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root='/tmp/andes56-feb0091';
const owned=['web/src/visuals/anatomy/','web/tests/visuals/anatomy/'];
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.json':'application/json','.svg':'image/svg+xml'};
createServer(async(req,res)=>{
  const p=new URL(req.url,'http://127.0.0.1:3056').pathname;
  const file=resolve(root,p==='/'?'web/tests/visuals/anatomy/preview-es.html':p.slice(1));
  if(!owned.some(dir=>file.startsWith(resolve(root,dir)+'/'))){res.writeHead(404).end();return}
  try{const body=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]??'text/plain','cache-control':'no-store'}).end(body)}
  catch{res.writeHead(404).end()}
}).listen(3056,'127.0.0.1',()=>console.log('Review Anatomyfeb0091 at http://127.0.0.1:3056/'));
