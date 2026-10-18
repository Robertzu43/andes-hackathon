// Independent, read-only candidate preview. Extracted candidate source remains unmodified.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
const dependencyRoot = realpathSync('/tmp/andes53-tools');
const root = realpathSync('/tmp/andes56-9d757a9/web/src/visuals/hairline/preview');
const require = createRequire(resolve(dependencyRoot, 'package.json'));
const { createServer, build } = await import(pathToFileURL(require.resolve('vite')).href);
const config = {
  root, configFile: false,
  plugins: [{ name: 'review-still-path', transformIndexHtml(html, context) {
    return context.server ? html.replace('src="../phone-rest.svg"', `src="/@fs/${resolve(root, '../phone-rest.svg')}"`) : html;
  } }],
  cacheDir: '/tmp/andes56-9d757a9-vite-cache',
  resolve: { alias: [
    { find: /^react-dom(\/.*)?$/, replacement: `${dependencyRoot}/node_modules/react-dom$1` },
    { find: /^react(\/.*)?$/, replacement: `${dependencyRoot}/node_modules/react$1` },
    { find: '@lucasmarkes/hairline/react', replacement: require.resolve('@lucasmarkes/hairline/react') },
    { find: '@lucasmarkes/hairline', replacement: require.resolve('@lucasmarkes/hairline') },
  ] },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 3056, strictPort: true,
    fs: { allow: [resolve(root, '..'), dependencyRoot] } },
  build: { outDir: '/tmp/andes56-9d757a9-build', emptyOutDir: true },
};
if (process.argv.includes('--build')) await build(config);
else { const server = await createServer(config); await server.listen(); server.printUrls(); }
