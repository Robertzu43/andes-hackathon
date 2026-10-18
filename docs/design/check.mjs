import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=p=>readFileSync(path.join(root,p),'utf8');
const t=JSON.parse(read('tokens.json')),c=t.color;
const luminance=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const pairs=[['ink','canvas'],['muted','canvas'],['ink','surface'],['muted','surface'],['onAction','action'],['onAction','actionPressed'],['onAction','danger'],['onAction','dangerPressed'],['positive','positiveSurface'],['warning','warningSurface'],['danger','dangerSurface'],['ink','subtle']];
const results=pairs.map(([foreground,background])=>{const values=[luminance(c[foreground]),luminance(c[background])].sort((a,b)=>a-b);const ratio=(values[1]+.05)/(values[0]+.05);assert.ok(ratio>=4.5,`${foreground}/${background}: ${ratio}`);return{foreground,background,ratio:Number(ratio.toFixed(2)),minimum:4.5};});
for(const background of ['canvas','surface']){const values=[luminance(c.border),luminance(c[background])].sort((a,b)=>a-b);const ratio=(values[1]+.05)/(values[0]+.05);assert.ok(ratio>=3);results.push({foreground:'border',background,ratio:Number(ratio.toFixed(2)),minimum:3});}
assert.ok(t.target.minimum>=48&&t.target.driving>=80&&t.target.gap>=16);
const components=JSON.parse(read('components.json'));assert.equal(components.length,20);assert.equal(new Set(components.map(x=>x.name)).size,20);
assert.equal(readdirSync(path.join(root,'screens')).filter(x=>x.endsWith('.svg')).length,6);
for(const match of read('index.html').matchAll(/(?:src|href)="([^"#]+)"/g)){if(!match[1].startsWith('http'))assert.ok(readFileSync(path.join(root,match[1])).length,match[1]);}
assert.match(read('preview.js'),/no se envió ningún aviso/);
assert.doesNotMatch(read('preview.js'),/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/);
writeFileSync(path.join(root,'evidence/contrast.json'),JSON.stringify({method:'WCAG relative luminance; nominal sRGB token pairs, not a full accessibility audit',results},null,2)+'\n');
console.log(`${results.length} contrast pairs passed; targets, 20 components, 6 screens and local links verified.`);
