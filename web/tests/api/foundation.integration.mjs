import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Actual public exports, pinned independently of the client branch. No source is
// vendored into production and missing source/dependencies must fail visibly.
const FOUNDATION = '3283fe675ebeee04bb2be8a62f42ab5c475b4b0e';
const repo = fileURLToPath(new URL('../../../', import.meta.url));

test('published FoundationRoot accepts the real API gateway through its public exports', async t => {
  const compiler = process.env.ANDES_TYPESCRIPT_TSC;
  const dependencies = process.env.ANDES_FOUNDATION_NODE_MODULES;
  assert.ok(compiler && existsSync(compiler), 'Set ANDES_TYPESCRIPT_TSC to an existing TypeScript5.9.3 compiler');
  assert.ok(dependencies && existsSync(join(dependencies, '@types/react/index.d.ts')),
    'Set ANDES_FOUNDATION_NODE_MODULES to the existing foundation web/node_modules; no implicit install');
  const archive = mkdtempSync(join(tmpdir(), 'andes-api-foundation-integration-'));
  try {
    writeFileSync(join(archive, 'package.json'), '{"type":"module"}\n');
    symlinkSync(dependencies, join(archive, 'node_modules'), 'dir');
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', FOUNDATION, 'web/src/foundation'],
      { cwd: repo, encoding: 'utf8' }).trim().split('\n');
    assert.ok(files.includes('web/src/foundation/index.ts'), 'Frozen public foundation entry must exist');
    for (const file of files) {
      assert.match(file, /^web\/src\/foundation\/[a-z0-9-]+\.tsx?$/);
      const target = join(archive, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, execFileSync('git', ['show', `${FOUNDATION}:${file}`], { cwd: repo }));
    }
    const api = fileURLToPath(new URL('../../src/lib/api/index.ts', import.meta.url));
    writeFileSync(join(archive, 'binding.ts'), `
import { createApiClient, createSessionGateway, MemorySession } from ${JSON.stringify(api)};
import { FoundationRoot, type FoundationOptions, type SessionGateway, type SessionSnapshot } from './web/src/foundation/index.ts';
const session = new MemorySession();
const api = createApiClient({ baseUrl: 'https://api.example.invalid', session });
const configured = createSessionGateway({ session, api, mode: 'external',
  acquire: async () => ({issuer:'https://identity.example.invalid',subject:'synthetic',accessToken:'synthetic',expiresAt:1}) });
const unconfigured = createSessionGateway({ session, api, mode: 'external' });
const gateways: SessionGateway[] = [configured, unconfigured];
for (const gateway of gateways) {
  const options: FoundationOptions = { session: gateway, initialLocale: 'es' };
  const snapshot: SessionSnapshot = gateway.getSnapshot();
  FoundationRoot(options);
  // @ts-expect-error the actual foundation snapshot cannot expose credentials
  const token: string = snapshot.accessToken;
  void token;
}
// Compile-only: never render, acquire credentials or call HTTP from this file.
`);
    for (const [module, resolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'Bundler']]) {
      await t.test(resolution, () => {
        execFileSync(process.execPath, [compiler, '--noEmit', '--strict', '--noUncheckedIndexedAccess',
          '--target', 'ES2023', '--module', module, '--moduleResolution', resolution,
          '--allowImportingTsExtensions', '--erasableSyntaxOnly', '--jsx', 'react-jsx',
          '--lib', 'ES2023,DOM,DOM.Iterable', join(archive, 'binding.ts')], { stdio: 'pipe' });
      });
    }
  } finally { rmSync(archive, { recursive: true, force: true }); }
});
