// Compose frozen dependencies without changing this branch or another lane's worktree.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const target = mkdtempSync(join(tmpdir(), 'andes-l51-ui-'));
// This branch carries main's web foundation. Only the typed client is still outside main:
// #81 (on #59) binds GET /v1/trips/:id/status and the invitation role that R6 needs.
const foundation = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
const api = '75bdffa42d858c82a8dcb0af11bc78803e3d9a09';
for (const [sha, paths] of [[foundation, ['web']], [api, ['web/src/lib/api']]]) {
  const archive = execFileSync('git', ['archive', sha, ...paths], { cwd: source, maxBuffer: 16_000_000 });
  execFileSync('tar', ['-x', '-C', target], { input: archive });
}
for (const path of ['web/src/features/contacts', 'web/src/features/privacy', 'web/tests/contacts', 'web/tests/privacy']) {
  mkdirSync(resolve(target, path, '..'), { recursive: true });
  cpSync(resolve(source, path), resolve(target, path), { recursive: true });
}
const receipt = { target, foundation, api,
  featureBase: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(),
  featureWorkingTree: execFileSync('git', ['status', '--porcelain'], { cwd: source, encoding: 'utf8' }).trim(),
};
writeFileSync(join(target, 'composition.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
