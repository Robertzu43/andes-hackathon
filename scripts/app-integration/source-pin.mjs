import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {BACKEND_SHA} from './receipts.mjs';

export function verifiedBackendSource() {
  const paths = ['src', 'db', 'package.json', 'package-lock.json', 'tsconfig.json'];
  const changed = spawnSync('git', ['diff', '--quiet', BACKEND_SHA, '--', ...paths]);
  const extra = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths], {encoding: 'utf8'});
  assert.ok(changed.status === 0 && extra.status === 0 && extra.stdout.trim() === '', 'Receipt export needs the pinned, unchanged backend source in a Git checkout');
  return BACKEND_SHA;
}
