import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(resolve(process.env.ANDES_VISUAL_TOOLS || web, 'package.json'));
const { chromium } = require('playwright-core');
const evidence = process.env.ANDES_VISUAL_EVIDENCE || '/tmp/andes53-evidence-r2';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Keep native observations; expose only the adapter's callback for ordered batches.
  await page.addInitScript(() => {
    const NativeObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback, options) {
        super((entries, observer) => {
          const entry = entries.find(item => item.target.matches('.andes-phone__frame'));
          if (entry) window.__phoneGate = { callback, observer, target: entry.target };
          callback(entries, observer);
        }, options);
      }
    };
  });
  await page.goto(process.env.ANDES_VISUAL_URL || 'http://127.0.0.1:3053');
  await page.getByRole('button', { name: 'Explorar la ilustración' }).click();
  await page.waitForSelector('[data-hairline] svg');
  const cases = [
    { entries: [true, false], expected: false, name: 'visible then offscreen stops the engine' },
    { entries: [false, true], expected: true, name: 'offscreen then visible mounts the engine' },
    { entries: [], expected: true, name: 'empty batch preserves the prior observation' },
    { entries: [false, 'foreign-visible'], expected: false, name: 'foreign target cannot override offscreen' },
    { entries: ['foreign-offscreen', true], expected: true, name: 'matching latest entry is selected' },
    { entries: ['foreign-offscreen'], expected: true, name: 'foreign-only batch preserves the prior observation' },
  ];
  for (const item of cases) {
    const error = await page.evaluate(entries => {
      const { callback, observer, target } = window.__phoneGate;
      try {
        callback(entries.map(value => ({
          target: typeof value === 'boolean' ? target : document.body,
          isIntersecting: value === true || value === 'foreign-visible',
        })), observer);
        return null;
      } catch (error) { return String(error); }
    }, item.entries);
    await page.waitForTimeout(100);
    const mounted = await page.locator('[data-hairline] svg').count() > 0;
    results.push({ ...item, error, mounted, pass: !error && mounted === item.expected });
  }
  const source = await readFile(resolve(web, 'src/visuals/hairline/PhoneIllustration.tsx'));
  await writeFile(resolve(evidence, 'visibility-batches.json'), JSON.stringify({
    kind: 'controlled-browser-observer-batches',
    sourceSha256: createHash('sha256').update(source).digest('hex'), results,
  }, null, 2));
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: mounted=${result.mounted}, expected=${result.expected}${result.error ? `, error=${result.error}` : ''}`);
  assert(results.every(result => result.pass), 'The latest matching observation must govern the engine');
} finally { await browser.close(); }
