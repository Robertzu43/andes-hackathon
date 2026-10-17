// Own resources independently of the aux foreground process, including forced exit.
import assert from 'node:assert/strict';
import {realpath, rm} from 'node:fs/promises';
import {basename, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {disposableDatabase} from './runtime.mjs';

assert.equal(process.env.ANDES_APP_INTEGRATION, 'synthetic-only');
assert.ok(process.connected, 'Fixture resource owner requires a private IPC parent');
let directory, creation, closing;
const deadline = setTimeout(() => void close(), 600000);
async function close() {
  if (closing) return closing;
  closing = (async () => {
    clearTimeout(deadline);
    try {const runtime = await creation; await runtime?.cleanup();}
    finally {
      if (directory) await rm(directory, {recursive: true, force: true});
      if (process.connected) process.disconnect();
    }
  })();
  return closing;
}
process.once('disconnect', () => void close());
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => void close());
process.on('message', async message => {
  if (message?.type === 'cleanup') {await close(); return;}
  if (message?.type !== 'create' || creation || closing) return;
  try {
    const candidate = await realpath(message.directory);
    assert.equal(dirname(candidate), await realpath(tmpdir()));
    assert.ok(basename(candidate).startsWith('andes-q46-browser-'));
    if (closing) return;
    directory = candidate;
    creation = disposableDatabase();
    const runtime = await creation;
    if (!closing && process.connected) {
      process.send({directory: runtime.directory, url: runtime.url, postgresVersion: runtime.postgresVersion});
    }
  } catch {
    if (process.connected) process.send({failed: true});
    await close(); process.exitCode = 1;
  }
});
