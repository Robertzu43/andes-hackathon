import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY, SCENARIOS, exampleOf, factsOf } from '../../../src/visuals/anatomy/model.mjs';
import { renderRelay } from '../../../src/visuals/anatomy/render.mjs';
import { ART } from '../../../src/visuals/anatomy/art.mjs';

test('no example infers delivery or assistance from acceptance or acknowledgement', () => {
  for (const name of SCENARIOS) {
    const example = exampleOf(name);
    assert.equal(example.delivery, 'unconfirmed');
    assert.equal(example.assistance, 'unconfirmed');
    assert.equal(example.flag, name === 'acknowledged' ? 1 : 0);
    assert.equal(example.contactAcknowledged, name === 'acknowledged');
  }
});
test('unconfirmed delivery cannot advance any mechanism beyond server acceptance', () => {
  const accepted = exampleOf('accepted'), unknown = exampleOf('unconfirmed');
  for (const key of ['dispatch', 'carriage', 'flag', 'serverAccepted', 'contactAcknowledged']) assert.equal(accepted[key], unknown[key]);
});
test('both locales retain every fact and source without JavaScript or SVG', () => {
  for (const locale of ['es', 'pt-BR']) {
    const copy = COPY[locale], html = renderRelay(locale);
    const text = html.replace(/<style>[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, '');
    for (const string of [copy.demo, ...copy.headings, ...copy.details, ...copy.sources, ...copy.facts]) assert.ok(text.includes(string), string);
    assert.equal(factsOf(exampleOf('acknowledged'), copy)[1], copy.values.unknown);
    assert.equal(factsOf(exampleOf('acknowledged'), copy)[3], copy.values.unknown);
    assert.match(html, /data-relay-controls[^>]+hidden/);
    assert.equal(copy.headings.length, 4);
  }
});
test('rejects unsupported examples/locales instead of inventing a state', () => {
  assert.throws(() => exampleOf('delivered'), RangeError);
  assert.throws(() => renderRelay('en'), RangeError);
});
test('Figure remains bounded and runtime never imports build-time geometry/audits', () => {
  assert.ok(ART.parts >= 40 && ART.parts <= 80);
  for (const file of ['index.mjs', 'render.mjs', 'model.mjs', 'styles.mjs']) {
    const source = readFileSync(new URL(`../../../src/visuals/anatomy/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*(?:vendor|geometry)/);
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|setInterval)\s*\(/);
  }
});
