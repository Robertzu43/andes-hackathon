import assert from 'node:assert/strict';
import test from 'node:test';
import { visualShell } from '../../../src/visuals/integration/shell.ts';
import { visualCopy } from '../../../src/visuals/integration/copy.ts';

for (const locale of ['es', 'pt-BR']) for (const kind of ['phone', 'relay']) {
  test(`${locale} ${kind}: text, facts and captions survive without JavaScript or SVG`, () => {
    const copy = visualCopy[locale][kind];
    const html = visualShell({ id: 'optional-help', locale, kind });
    for (const text of [copy.title, copy.caption, copy.parked, ...copy.facts]) assert.ok(html.includes(text));
    assert.ok(html.includes(`lang="${locale}"`));
    assert.ok(html.includes('aria-describedby="optional-help-caption"'));
    assert.ok(html.includes('data-visual-controls hidden'));
    assert.doesNotMatch(html, /<svg|<script|autoplay|<iframe|https?:/);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(visualCopy.es.phone).sort());
  });
}

test('translated feature copy cannot inject HTML or attributes', () => {
  const unsafe = '<img src=x onerror="alert(1)"> & \'quoted\'';
  const copy = { ...visualCopy.es.phone, title: unsafe, caption: unsafe, facts: [unsafe] };
  const html = visualShell({ id: 'safe-id', kind: 'phone', locale: 'es', copy });
  assert.doesNotMatch(html, /<img/);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;'));
  assert.throws(() => visualShell({ id: 'bad" id', locale: 'es', kind: 'phone' }));
});
