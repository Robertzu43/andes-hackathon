import test from 'node:test';
import assert from 'node:assert/strict';
import { strictTimestamp, formattedTimestamp } from '../../src/foundation/time.ts';

test('untrusted timestamps need a complete ISO calendar value and explicit zone', () => {
  for (const value of ['0','hello 5','','2026-10-17','2026-10-17T12:00:00','2026-10-17 12:00:00Z','2026-10-17T12:00:00+0300']) {
    assert.equal(strictTimestamp(value),false,value);
    assert.equal(formattedTimestamp(value,'es'),null,value);
  }
});
test('calendar, clock and offset values cannot normalize into invented times', () => {
  for (const value of ['2026-02-30T12:00:00Z','2025-02-29T12:00:00Z','1900-02-29T12:00:00Z','2026-00-10T12:00:00Z','2026-12-00T12:00:00Z','2026-10-17T24:00:00Z','2026-10-17T12:60:00Z','2026-10-17T12:00:60Z','2026-10-17T12:00:00+24:00','2026-10-17T12:00:00+03:60']) {
    assert.equal(strictTimestamp(value),false,value);
  }
});
test('valid leap dates, fractions and explicit offsets remain accepted', () => {
  for (const value of ['2000-02-29T12:00:00Z','2024-02-29T00:00:00.123Z','2026-10-17T12:00:00+05:30','2026-10-17T12:00:00-03:00']) assert.equal(strictTimestamp(value),true,value);
});
test('timestamps use the supplied trip zone without the browser zone', () => {
  const value='2026-10-17T12:00:00Z';
  assert.match(formattedTimestamp(value,'es','America/Lima'),/7:00.*\(America\/Lima\)$/);
  assert.match(formattedTimestamp(value,'pt-BR','America/Sao_Paulo'),/09:00.*\(America\/Sao_Paulo\)$/);
  assert.match(formattedTimestamp(value,'es'),/12:00.*\(UTC\)$/);
  assert.equal(formattedTimestamp(value,'es','invalid-zone'),null);
});
