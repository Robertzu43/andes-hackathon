// The driver's contact list never shows a phone. #65 made catalogs phone-free; a row that still
// carries one (an older server, a stale fixture) must not reach the screen either.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const E164 = /\+?[1-9]\d{6,14}/;
const row = (id, role, status) => ({ id, contactId: '00000000-0000-4000-8000-0000000000aa', role,
  map: { requested: true, accepted: status === 'accepted' }, incident: { requested: true, accepted: status === 'accepted' },
  status, acceptedAt: status === 'accepted' ? '2026-10-17T12:00:00.000Z' : null, revokedAt: null, revokedBy: null,
  phone: '+15555550100' });

test('contact rows are headed by role and a short alias, never an E.164 phone', async t => {
  const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
    logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false } });
  t.after(() => vite.close());
  const { Catalog } = await vite.ssrLoadModule('/src/features/contacts/routes.tsx');
  const { I18nProvider } = await vite.ssrLoadModule('/src/foundation/index.ts');
  const snapshot = { journey: { operation: { status: 'idle' } }, catalog: { status: 'ready', failure: null,
    data: { limit: 100, hasMore: false, readAt: '2026-10-17T12:03:00.000Z', contacts: [
      row('00000000-0000-4000-8000-00000000c3f9', 'family', 'accepted'),
      row('00000000-0000-4000-8000-0000000071ab', 'colleague', 'pending')] } } };
  for (const [locale, headings] of [['es', ['Familia · Contacto C3F9', 'Colega · Contacto 71AB']],
    ['pt-BR', ['Família · Contato C3F9', 'Colega · Contato 71AB']]]) {
    const html = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale },
      createElement(Catalog, { store: {}, snapshot })));
    assert.deepEqual([...html.matchAll(/<h3>(.*?)<\/h3>/g)].map(match => match[1]), headings, locale);
    assert.doesNotMatch(html, E164, locale);
  }
});
