import { createServer, preview, build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { figureSources } from './figure-sources.mjs';

const webRoot = fileURLToPath(new URL('../../../', import.meta.url));
const entry = '/tests/visuals/integration/foundation.html';
const outDir = process.env.VISUAL_FOUNDATION_BUILD ?? '/tmp/andes55-foundation-build';
const port = Number(process.env.VISUAL_FIXTURE_PORT ?? 3055);
const dependencies = JSON.parse(await readFile(resolve(webRoot, '../.codus/visual-fixtures/dependencies.json'), 'utf8'));
for (const [kind, source] of Object.entries(figureSources)) {
  if (dependencies[kind]?.revision !== source.revision) throw new Error('Run prepare-figures.mjs for the exact frozen dependency sources');
}
const require = createRequire(resolve(webRoot, 'package.json'));
const rewrite = server => {
  server.middlewares.use((req, _res, next) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (['/', '/contacts'].includes(url.pathname)) req.url = entry + url.search;
    next();
  });
};
const config = {
  root: webRoot,
  configFile: resolve(webRoot, 'vite.config.ts'),
  cacheDir: '/tmp/andes55-foundation-vite',
  resolve: { alias: [
    { find: 'andes-reviewed-phone', replacement: resolve(dependencies.phone.directory, 'index.mjs') },
    { find: 'andes-reviewed-relay', replacement: resolve(dependencies.relay.directory, 'index.mjs') },
    { find: /^react-dom(\/.*)?$/, replacement: `${webRoot}/node_modules/react-dom$1` },
    { find: /^react(\/.*)?$/, replacement: `${webRoot}/node_modules/react$1` },
    { find: '@lucasmarkes/hairline/react', replacement: require.resolve('@lucasmarkes/hairline/react') },
  ] },
  plugins: [{ name: 'owned-visual-fixture-entry', configureServer: rewrite, configurePreviewServer: rewrite }],
  server: { host: '127.0.0.1', port, strictPort: true },
  preview: { host: '127.0.0.1', port, strictPort: true },
  build: { outDir, emptyOutDir: true, manifest: true, rollupOptions: { input: resolve(webRoot, '.' + entry) } },
};
if (process.argv.includes('--build')) await build(config);
else if (process.argv.includes('--preview')) (await preview(config)).printUrls();
else { const server = await createServer(config); await server.listen(); server.printUrls(); }
