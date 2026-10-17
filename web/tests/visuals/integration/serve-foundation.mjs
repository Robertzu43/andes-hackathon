import { createServer, preview, build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const webRoot = fileURLToPath(new URL('../../../', import.meta.url));
const entry = '/tests/visuals/integration/foundation.html';
const outDir = process.env.VISUAL_FOUNDATION_BUILD ?? '/tmp/andes55-foundation-build';
const port = Number(process.env.VISUAL_FIXTURE_PORT ?? 3055);
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
  plugins: [{ name: 'owned-visual-fixture-entry', configureServer: rewrite, configurePreviewServer: rewrite }],
  server: { host: '127.0.0.1', port, strictPort: true },
  preview: { host: '127.0.0.1', port, strictPort: true },
  build: { outDir, emptyOutDir: true, manifest: true, rollupOptions: { input: resolve(webRoot, '.' + entry) } },
};
if (process.argv.includes('--build')) await build(config);
else if (process.argv.includes('--preview')) (await preview(config)).printUrls();
else { const server = await createServer(config); await server.listen(); server.printUrls(); }
