import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));
const driver = process.env.ANATOMY_DRIVER ?? join(homedir(), '.agents/skills/anatomy/scripts/drive.mjs');
const base = 'http://127.0.0.1:3054/web/tests/visuals/anatomy/';
const evidence = name => join(here, 'evidence', name);
const assert = (condition, message) => `if(!(${condition}))throw new Error(${JSON.stringify(message)});`;
const audit = `(()=>{
  const root=document.querySelector('.andes-relay'),buttons=[...root.querySelectorAll('button')];
  ${assert("buttons.length===4 && buttons.every(b=>b.getBoundingClientRect().height>=44)", 'four visible touch controls')}
  ${assert("!root.querySelector('[data-relay-controls]').hidden", 'interactive module loaded')}
  ${assert("document.documentElement.scrollWidth<=innerWidth", 'horizontal overflow')}
  ${assert("root.querySelector('svg').getAttribute('aria-label').length>30", 'named illustration')}
  ${assert("root.querySelector('[data-relay-static]').hidden", 'progressive enhancement')}
  const linear=v=>(v/=255)<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  const l=c=>{const rgb=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(linear);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]};
  const ratio=(a,b)=>(Math.max(l(a),l(b))+.05)/(Math.min(l(a),l(b))+.05);
  const ink=getComputedStyle(root).color,bg=getComputedStyle(document.body).backgroundColor;
  const primary=getComputedStyle(buttons[0]);
  const text=ratio(ink,bg),selected=ratio(primary.color,primary.backgroundColor);
  ${assert('text>=4.5 && selected>=4.5', 'runtime text contrast')}
  return {viewport:[innerWidth,innerHeight],buttons:buttons.length,textContrast:text,selectedContrast:selected};
})()`;

function run(label, locale, width, height, actions, flags = []) {
  const path = evidence(`${label}-actions.json`);
  writeFileSync(path, JSON.stringify(actions, null, 2));
  const result = spawnSync(process.execPath, [driver, `${base}preview-${locale}.html`, '--actions', path, '--width', String(width), '--height', String(height), ...flags], { encoding: 'utf8', timeout: 50000 });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(evidence(`${label}.log`), output);
  console.log(label, output.trim());
  if (result.status !== 0 || !output.includes('console: clean')) throw new Error(`${label} failed (${result.status})`);
}

for (const locale of ['es', 'pt-BR']) for (const [width, height] of [[360,800],[390,844],[430,932],[1440,900],[1920,1080]]) {
  const label = `${locale}-${width}x${height}`;
  run(label, locale, width, height, [
    ['wait', 200], ['eval', audit],
    ['shot', evidence(`${label}-viewport.png`), 'body', 1, [0,0,width,height]],
    ['shot', evidence(`${label}-module.png`), '.andes-relay', 1],
    ['key', 'End', '[data-example="local"]'], ['wait', 450],
    ['eval', `(()=>{${assert("document.activeElement.dataset.example==='acknowledged'", 'keyboard End focuses acknowledgement')}${assert("document.querySelector('.andes-relay').dataset.relayExample==='acknowledged'", 'keyboard selects example')}${assert("document.querySelector('[data-relay-motion=flag]').getAttribute('transform')!=='translate(0 0)'", 'acknowledgement raises flag')}return 'keyboard + flag pass'})()`],
    ['shot', evidence(`${label}-acknowledged.png`), '.andes-relay', 1],
    ['key', 'Home', '[data-example="acknowledged"]'], ['wait', 450],
    ['eval', `(()=>{${assert("document.querySelector('[data-relay-motion=flag]').getAttribute('transform')==='translate(0 0)'", 'Home lowers flag')}return 'Home pass'})()`],
  ]);
}

run('poses-and-joints', 'es', 1440, 1000, [
  ['wait', 200], ['lines', evidence('lines-local.png')],
  ['shot', evidence('joints-local-4x.png'), '.iso-plate', 4],
  ['click', '[data-example=accepted]'], ['wait', 450], ['lines', evidence('lines-accepted.png')],
  ['eval', 'window.acceptedArt=[...document.querySelectorAll("[data-relay-part]")].map(n=>[n.dataset.relayPart,n.getAttribute("transform")]);true'],
  ['click', '[data-example=unconfirmed]'], ['wait', 450], ['lines', evidence('lines-unconfirmed.png')],
  ['eval', `(()=>{${assert('JSON.stringify(window.acceptedArt)===JSON.stringify([...document.querySelectorAll("[data-relay-part]")].map(n=>[n.dataset.relayPart,n.getAttribute("transform")]))', 'unknown delivery must not move art')}return 'no implied delivery pass'})()`],
  ['click', '[data-example=acknowledged]'], ['wait', 450], ['lines', evidence('lines-acknowledged.png')],
  ['shot', evidence('joints-acknowledged-4x.png'), '.iso-plate', 4],
]);

run('reduced-motion', 'pt-BR', 390, 844, [
  ['wait', 200], ['click', '[data-example=acknowledged]'],
  ['eval', `(()=>{${assert('matchMedia("(prefers-reduced-motion: reduce)").matches', 'reduced-motion emulation')}${assert("document.querySelector('[data-relay-motion=flag]').getAttribute('transform')!=='translate(0 0)'", 'meaningful still flag')}return 'reduced-motion pass'})()`],
  ['shot', evidence('reduced-motion.png'), '.andes-relay', 1],
], ['--reduced']);

// This is a deliberately unenhanced HTML fixture, equivalent to a blocked or
// failed module load. The browser still runs the assertions through CDP.
for (const locale of ['es','pt-BR']) {
  const page = readFileSync(join(here, `preview-${locale}.html`), 'utf8').replace(/<script type="module">[\s\S]*?<\/script>/, '');
  writeFileSync(join(here, `preview-static-${locale}.html`), page);
}
console.log('Browser matrix complete; lifecycle checks run separately');
