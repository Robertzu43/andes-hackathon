// Captures stay in the journey temp dir. Copying them out is an explicit opt-in.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('phone captures leave the temp dir only when a destination is set', async () => {
  const { copyPhoneCaptures } = await import('./captures.mjs');
  const shotDir = await mkdtemp(join(tmpdir(), 'andes-phone-shots-'));
  const destination = await mkdtemp(join(tmpdir(), 'andes-phone-out-'));
  try {
    await mkdir(join(shotDir, 'captures'));
    await writeFile(join(shotDir, 'captures', '01-welcome.png'), 'png');
    assert.equal(await copyPhoneCaptures(shotDir, undefined), false);
    assert.equal(await copyPhoneCaptures(shotDir, ''), false);
    assert.equal(existsSync(join(destination, '01-welcome.png')), false);
    assert.equal(await copyPhoneCaptures(shotDir, destination), true);
    assert.equal(existsSync(join(destination, '01-welcome.png')), true);
    assert.equal(existsSync(join(shotDir, 'captures', '01-welcome.png')), true);
  } finally {
    await rm(shotDir, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});

test('the phone journey does not hardcode a screenshot directory', async () => {
  const source = await readFile(new URL('./journey.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('/opt/'), false);
  assert.match(source, /process\.env\.ANDES_SCREENSHOT_DIR/);
});
