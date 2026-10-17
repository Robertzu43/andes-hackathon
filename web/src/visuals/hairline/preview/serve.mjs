// Standalone synthetic preview only. Uses the shared web dependencies when present.
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dependencyRoot = realpathSync(process.env.ANDES_VISUAL_TOOLS || resolve(root, '../../../..'));
const require = createRequire(resolve(dependencyRoot, 'package.json'));
const { createServer, build } = await import(pathToFileURL(require.resolve('vite')).href);
const config = {
  root,
  configFile: false,
  plugins: [{
    name: 'owned-preview-still-image',
    transformIndexHtml(html, context) {
      // In dev, a browser resolves ../ at the URL root. Builds resolve it on disk.
      return context.server ? html.replace('src="../phone-rest.svg"',
        `src="/@fs/${resolve(root, '../phone-rest.svg')}"`) : html;
    },
  }],
  cacheDir: '/tmp/andes53-vite-cache',
  resolve: { alias: [
    { find: /^react-dom(\/.*)?$/, replacement: `${dependencyRoot}/node_modules/react-dom$1` },
    { find: /^react(\/.*)?$/, replacement: `${dependencyRoot}/node_modules/react$1` },
    { find: '@lucasmarkes/hairline/react', replacement: require.resolve('@lucasmarkes/hairline/react') },
    { find: '@lucasmarkes/hairline', replacement: require.resolve('@lucasmarkes/hairline') },
  ] },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 3053, strictPort: true,
    fs: { allow: [resolve(root, '..'), dependencyRoot] } },
  build: { outDir: process.env.ANDES_VISUAL_BUILD || '/tmp/andes53-build', emptyOutDir: true },
};
if (process.argv.includes('--build')) await build(config);
else {
  const server = await createServer(config);
  await server.listen();
  server.printUrls();
}
