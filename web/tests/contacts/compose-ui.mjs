// Compose frozen dependencies without changing this branch or another lane's worktree.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const target = mkdtempSync(join(tmpdir(), 'andes-l51-ui-'));
const foundation = '3283fe675ebeee04bb2be8a62f42ab5c475b4b0e';
const api = 'db7034fc9e1dba035b87368117376e9730d6b830';
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
