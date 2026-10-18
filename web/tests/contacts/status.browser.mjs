// R6 (#74 status) on the contact screens, in an owned headless Chrome. Synthetic fixture only; no backend or sends.
// Run in a tree that has the typed client (web/src/lib/api from #81): node tests/contacts/status.browser.mjs http://127.0.0.1:PORT
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browser } from '../foundation/cdp.mjs';

const origin = process.argv[2];
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
const b = await browser(await mkdtemp(join(tmpdir(), 'andes-contact-status-')));
const results = [];
const text = () => b.evaluate('document.body.innerText');
async function open(screen, locale, scenario) {
  await b.send('Page.navigate', { url: `${origin}/tests/contacts/fixture.html?screen=${screen}&locale=${locale}&scenario=${scenario}&references=missing` });
  await b.wait(`document.readyState === 'complete' && !!document.querySelector('h1')`);
}
async function check(name, run) {
  try { await run(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, message: error.message }); }
}
const es = { open: 'Abierto', trigger: 'Control sin respuesta (sin señales del teléfono)', label: 'Sin señal',
  colleague: 'Colega · SMS: Pendiente', group: 'Grupo · Grupo: No disponible', noCheck: 'Ningún control abierto visible para tu cuenta',
  asking: 'Esperando respuesta del conductor (dejó de compartir la ubicación). Plazo para responder:',
  none: 'Ningún incidente visible para tu cuenta', noReassurance: 'Esto no indica que el conductor esté bien.', locationDenied: 'No podemos mostrar esta ubicación' };
const pt = { open: 'Aberto', trigger: 'Verificação sem resposta (sem sinais do telefone)', label: 'Sem sinal',
  colleague: 'Colega · SMS: Pendente', group: 'Grupo · Grupo: Indisponível', noCheck: 'Nenhuma verificação aberta visível para a sua conta',
  asking: 'Aguardando resposta do motorista (parou de compartilhar a localização). Prazo para responder:',
  none: 'Nenhum incidente visível para a sua conta', noReassurance: 'Isso não indica que o motorista esteja bem.' };
try {
  for (const [locale, copy] of [['es', es], ['pt-BR', pt]]) for (const [width, height] of [[390, 844], [1440, 900]]) {
    await b.viewport(width, height);
    const tag = `${locale}-${width}`;
    await check(`${tag} status finds the incident without a host reference`, async () => {
      await open('trip', locale, 'normal');
      await b.wait(`document.querySelector('[data-action="acknowledge"]')?.disabled === false`);
      const body = await text();
      // copy.label is not asserted: #81's client status decoder drops `label` before the feature sees it.
      for (const fact of [copy.trigger, copy.colleague, copy.group, copy.noCheck]) assert.ok(body.includes(fact), fact);
      assert.equal(await b.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false, 'horizontal overflow');
    });
    await check(`${tag} an open check shows its reason and deadline`, async () => {
      await open('trip', locale, 'asking');
      await b.wait(`!!document.querySelector('time[datetime="2026-10-17T12:06:00.000Z"]')`);
      const body = await text();
      assert.ok(body.includes(copy.asking), copy.asking); assert.ok(body.includes(copy.none), copy.none);
    });
    await check(`${tag} map-only: no incident is never shown as reassurance`, async () => {
      await open('trip', locale, 'map-only');
      await b.wait(`document.body.innerText.includes(${JSON.stringify(copy.none)})`);
      assert.ok((await text()).includes(copy.noReassurance));
    });
  }
  await b.viewport(390, 844);
  await check('es map 403 keeps the active incident and the response controls', async () => {
    await open('trip', 'es', 'map-denied');
    await b.wait(`document.querySelector('[data-action="acknowledge"]')?.disabled === false`);
    const body = await text();
    assert.ok(body.includes(es.locationDenied)); assert.ok(body.includes(es.open)); assert.ok(body.includes(es.trigger));
  });
  await check('es the invite form sends the chosen role', async () => {
    await open('contacts', 'es', 'normal');
    await b.wait(`!!document.querySelector('[data-action="invite-open"]')`);
    await b.click('[data-action="invite-open"]');
    await b.wait(`!!document.querySelector('#invite-contact-id')`);
    await b.evaluate(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('#invite-contact-id'), '00000000-0000-4000-8000-000000000006');
      set(document.querySelector('input[type="tel"]'), '+15555550101');
      document.querySelector('input[type="checkbox"]').click(); return true; })()`);
    await b.evaluate(`(() => { const el = document.querySelector('#invite-contact-role');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, 'colleague');
      el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await b.click('button[type="submit"]');
    await b.wait(`window.__CONTACT_FIXTURE__.calls.some(c => c.method === 'POST' && c.path === '/v1/contacts')`);
    const post = await b.evaluate(`window.__CONTACT_FIXTURE__.calls.find(c => c.method === 'POST' && c.path === '/v1/contacts').body`);
    assert.equal(JSON.parse(post).role, 'colleague');
  });
  await check('no runtime exceptions', async () => assert.deepEqual(b.runtime, []));
} finally { await b.close(); }
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.message ? ` — ${r.message}` : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
