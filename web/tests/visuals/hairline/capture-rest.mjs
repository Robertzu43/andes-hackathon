// Capture unchanged upstream Phone geometry, not a reimplementation of its engine.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../../../', import.meta.url));
const dependencyRoot = process.env.ANDES_VISUAL_TOOLS || web;
const require = createRequire(resolve(dependencyRoot, 'package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.ANDES_VISUAL_URL || 'http://127.0.0.1:3053');
  const assets = await page.evaluate(async moduleURL => {
    const { phone } = await import(moduleURL);
    return [0, 0.5, 1].map(intensity => {
      const element = document.createElement('div');
      element.style.cssText = 'width:400px;height:320px;--hairline-plate:#fcfdfd;--hairline-hi:#173139;--hairline-edge:#617a81;--hairline-mid:#84989e;--hairline-lo:#a6b8bd';
      document.body.append(element);
      const figure = phone(element, { theme: 'light', intensity, play: false });
      const svg = element.querySelector('svg');
      const clone = svg.cloneNode(true);
      for (const [index, path] of [...svg.querySelectorAll('path')].entries()) {
        const style = getComputedStyle(path);
        const target = clone.querySelectorAll('path')[index];
        for (const name of ['fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray', 'vector-effect']) {
          target.setAttribute(name, style.getPropertyValue(name));
        }
        target.removeAttribute('class');
      }
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.removeAttribute('aria-hidden');
      const result = new XMLSerializer().serializeToString(clone);
      figure.destroy();
      element.remove();
      return result;
    });
  }, `/@fs/${require.resolve('@lucasmarkes/hairline')}`);
  const names = ['phone-rest-compact.svg', 'phone-rest.svg', 'phone-rest-open.svg'];
  for (const [index, svg] of assets.entries()) {
    const target = resolve(web, 'src/visuals/hairline', names[index]);
    await writeFile(target, svg + '\n');
    console.log(`${names[index]}: ${Buffer.byteLength(svg)} bytes`);
  }
} finally { await browser.close(); }
