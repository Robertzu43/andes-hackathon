import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
const here = fileURLToPath(new URL('.', import.meta.url));
const driver = process.env.ANATOMY_DRIVER ?? join(homedir(), '.agents/skills/anatomy/scripts/drive.mjs');
for (const locale of ['es','pt-BR']) for (const [width,height] of [[360,800],[390,844]]) {
  const label = `longest-${locale}-${width}`;
  const actions = [
    ['key','ArrowRight','[data-example=local]'], ['wait',450],
    ['eval', `(()=>{const root=document.querySelector('.andes-relay');if(root.dataset.relayExample!=='accepted')throw new Error('acceptance selection');const labels=[...root.querySelectorAll('.ar-corners:last-child span')].map(n=>n.getBoundingClientRect());if(labels[0].right>labels[1].left-7)throw new Error('readout overlaps hint');if(document.documentElement.scrollWidth>innerWidth)throw new Error('overflow');if(document.querySelector('[data-relay-motion=flag]').getAttribute('transform')!=='translate(0 0)')throw new Error('acceptance raised flag');return{locale:root.lang,width:innerWidth,readout:root.querySelector('[data-readout]').textContent,overlap:false}})()`],
    ['shot',join(here,'evidence',`${label}.png`),'.andes-relay',1],
  ];
  const path=join(here,'evidence',`${label}-actions.json`);
  writeFileSync(path,JSON.stringify(actions,null,2));
  const result=spawnSync(process.execPath,[driver,`http://127.0.0.1:3054/web/tests/visuals/anatomy/preview-${locale}.html`,'--actions',path,'--width',String(width),'--height',String(height)],{encoding:'utf8',timeout:20000});
  writeFileSync(join(here,'evidence',`${label}.log`),(result.stdout??'')+(result.stderr??''));
  console.log(result.stdout,result.stderr);
  if(result.status!==0)throw new Error(label+' failed');
}
