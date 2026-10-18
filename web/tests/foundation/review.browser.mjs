// Actual browser regressions for PR56 review5560836421. No backend or sends.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browser } from './cdp.mjs';
const origin = process.argv[2];
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
const output = await mkdtemp(join(tmpdir(), 'andes-foundation-review-'));
const b = await browser(output); const results = [];
async function check(id, run) {
  try { await run(); results.push({ id, passed: true }); }
  catch (error) { results.push({ id, passed: false, message: error.message }); }
}
async function open(scenario) {
  await b.send('Page.navigate', { url: `${origin}/tests/fixtures/review.html?case=${scenario}` });
  await b.wait(`document.readyState === 'complete' && window.__FOUNDATION_REVIEW_LOADED__ === ${JSON.stringify(scenario)}`);
  await b.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await b.capture(scenario);
}
try {
  await b.viewport(390,844);
  await check('class gateway preserves this and authenticates', async () => {
    await open('class-gateway');
    assert.equal(await b.evaluate('!!document.querySelector("header")'), true);
    await b.click('[data-action="session-primary"]');
    await b.wait('document.body.innerText.includes("Tu cuenta está conectada")');
  });
  for (const scenario of ['throw-route','throw-gateway']) await check(`${scenario} preserves shell and recovery`, async () => {
    await open(scenario);
    assert.equal(await b.evaluate(`!!document.querySelector('header') && !!document.querySelector('footer a[href="/session"]') && !!document.querySelector('[data-route-recovery]')`), true);
  });
  await check('a route failure leaves separately hosted critical actions usable', async () => {
    await open('critical-route'); await b.click('[data-review-critical]');
    assert.equal(await b.evaluate(`document.querySelector('[data-review-count]')?.textContent`),'1');
    await b.key(' ', '[data-review-critical]');
    assert.equal(await b.evaluate(`document.querySelector('[data-review-count]')?.textContent`),'2');
  });
  await check('trip metadata does not assert an active state', async () => {
    await open('trip');
    assert.equal(await b.evaluate('!document.title.includes("en curso") && !document.title.includes("em andamento")'), true);
  });
  await open('facts');
  for (const label of ['zero','loose','no-zone','invalid-calendar']) await check(`timestamp ${label} is unknown`, async () => {
    const text = await b.evaluate(`(()=>{const row=[...document.querySelectorAll('dt')].find(e=>e.textContent===${JSON.stringify(label)});return row?.nextElementSibling?.textContent;})()`);
    assert.ok(text?.includes('Sin información'), text);
  });
  await check('valid zoned timestamp remains visible', async () => {
    assert.equal(await b.evaluate(`!!document.querySelector('time[datetime="2026-10-17T12:00:00Z"]')`), true);
  });
  for (const [label,prefix,time] of [['captured-zone','Capturado','7:00'],['received-zone','Recibido','7:01']]) await check(`${label} retains its source meaning and trip zone`, async () => {
    const text=await b.evaluate(`(()=>{const row=[...document.querySelectorAll('dt')].find(e=>e.textContent===${JSON.stringify(label)});return row?.nextElementSibling?.textContent;})()`);
    assert.ok(text?.includes(prefix),text);assert.ok(text?.includes(time),text);assert.ok(text?.includes('(America/Lima)'),text);
  });
  await check('attributed time is localized rather than raw ISO', async () => {
    assert.equal(await b.evaluate('!document.querySelector("[data-review=attributed]").textContent.includes("2026-10-17T12:00:00Z")'), true);
  });
  await check('initial route does not steal feature autofocus', async () => {
    await open('focus'); assert.equal(await b.evaluate('document.activeElement?.id'), 'feature-input');
  });
  await check('language change preserves focus and scroll', async () => {
    await b.evaluate('window.scrollTo(0,200);document.querySelector(".andes-language select").focus({preventScroll:true})');
    const scroll = await b.evaluate('scrollY');
    await b.select('.andes-language select','pt-BR');
    await b.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    assert.equal(await b.evaluate('document.activeElement?.matches(".andes-language select")'), true);
    assert.equal(await b.evaluate('scrollY'), scroll);
  });
  await check('trailing-slash navigation is current', async () => {
    await b.goto(origin+'/trucks/');
    assert.equal(await b.evaluate(`document.querySelector('.andes-nav a[href="/trucks"]')?.getAttribute('aria-current')`), 'page');
  });
  await check('later authentication clears an earlier local failure alert', async () => {
    await open('failed-alert'); await b.select('.andes-language select','es');
    await b.click('[data-action="session-primary"]');
    await b.wait('!!document.querySelector("[role=alert]")');
    await b.evaluate('window.__FOUNDATION_REVIEW_AUTHENTICATE__()');
    await b.wait('document.body.innerText.includes("Tu cuenta está conectada")');
    assert.equal(await b.evaluate('!!document.querySelector("[role=alert]")'), false);
  });
  await b.capture('final-surface');
} finally { await b.close(); }
const report={output,results,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length};
await writeFile(join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
process.exitCode=report.failed?1:0;
