import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { figureSources } from './figure-sources.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const root = resolve(repository, '.codus/visual-fixtures');
const manifest = {};
for (const [kind, source] of Object.entries(figureSources)) {
  const target = resolve(root, `${kind}-${source.revision}`);
  await mkdir(target, { recursive: true });
  const archive = execFileSync('git', ['archive', source.revision, source.path], { cwd: repository });
  execFileSync('tar', ['-xf', '-', '-C', target], { input: archive });
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', source.revision, '--', source.path], { cwd: repository, encoding: 'utf8' }).trim().split('\n');
  const files = [];
  for (const path of paths) {
    const bytes = await readFile(resolve(target, path));
    const original = execFileSync('git', ['show', `${source.revision}:${path}`], { cwd: repository });
    if (!bytes.equals(original)) throw new Error(`Dependency source mismatch: ${path}`);
    files.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  manifest[kind] = { ...source, directory: resolve(target, source.path), files };
}
await writeFile(resolve(root, 'dependencies.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(manifest).map(([kind, item]) => [kind, { revision: item.revision, files: item.files.length }])), null, 2));
