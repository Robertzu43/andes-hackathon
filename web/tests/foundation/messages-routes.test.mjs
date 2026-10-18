import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isLocale, messages, message, readLanguageChoice, saveLanguageChoice } from '../../src/foundation/messages.ts';
import { routeDefinitions, routePath, validRouteParams } from '../../src/foundation/routes.ts';

test('all shared semantic keys have nonempty Spanish and Brazilian Portuguese values', () => {
  assert.deepEqual(Object.keys(messages.es).sort(), Object.keys(messages['pt-BR']).sort());
  for (const locale of ['es', 'pt-BR']) for (const text of Object.values(messages[locale])) assert.ok(text.trim());
  assert.equal(message('es', 'trucks'), 'Camiones');
  assert.equal(message('pt-BR', 'trucks'), 'Caminhões');
});
test('language follows explicit choice, including when preference storage is blocked', () => {
  assert.equal(readLanguageChoice(), 'es');
  assert.equal(readLanguageChoice({ getItem: () => 'pt-BR' }), 'pt-BR');
  assert.equal(readLanguageChoice({ getItem: () => 'BR' }), 'es');
  assert.equal(readLanguageChoice({ getItem: () => { throw new Error('blocked'); } }), 'es');
  const writes = [];
  saveLanguageChoice('pt-BR', { setItem: (...args) => writes.push(args) });
  assert.deepEqual(writes, [['andes.locale', 'pt-BR']]);
  assert.doesNotThrow(() => saveLanguageChoice('es', { setItem: () => { throw new Error('blocked'); } }));
  assert.equal(isLocale('pt'), false);
  assert.equal(isLocale('pt-BR'), true);
});
test('the router implements exactly the released utility route patterns without backend route invention', () => {
  const config = JSON.parse(readFileSync(new URL('../../../docs/seo/site.config.json', import.meta.url)));
  assert.deepEqual(routeDefinitions.map(r => r.path).sort(), config.routes.map(r => r.path).sort());
  assert.equal(new Set(routeDefinitions.map(r => r.id)).size, 12);
  for (const route of routeDefinitions) {
    const row = config.routes.find(item => item.path === route.path);
    assert.equal(`${message('es', route.title)} | ANDES`, row.title);
  }
});
test('opaque UUID route identifiers are validated without adding user data to titles', () => {
  const id = '00000000-0000-4000-8000-000000000049';
  assert.equal(routePath('activeTrip', { tripId: id }), `/trips/${id}`);
  assert.equal(routePath('invitation', { grantId: id }), `/contact/invitations/${id}`);
  assert.equal(validRouteParams({ tripId: id }), true);
  for (const value of [undefined, '', '../session', 'name?token=secret', '<img>']) {
    assert.equal(validRouteParams({ tripId: value }), false);
    assert.throws(() => routePath('activeTrip', { tripId: value }));
  }
  assert.equal(routePath('session'), '/session');
  for (const locale of ['es', 'pt-BR']) for (const route of routeDefinitions) assert.ok(!message(locale, route.title).includes(id));
});
