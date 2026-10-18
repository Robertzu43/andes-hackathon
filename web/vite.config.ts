import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localApiTarget, webPort } from './src/app/config.ts';
import { unconfiguredApi } from './src/app/unconfigured-api.ts';

export default defineConfig(({ mode }) => {
  // Runtime configuration is explicit shell input. Never load an API target from a client dotenv file.
  const port = webPort(process.env.ANDES_WEB_PORT);
  const target = localApiTarget(process.env.ANDES_API_PROXY_TARGET);
  const proxy = target ? { '^/v1(?:/|\\?|$)': { target, changeOrigin: false } } : undefined;
  return {
    plugins: [react(), {
      name: 'andes-local-boundary',
      transformIndexHtml(_html, context) {
        const address = context.server?.httpServer?.address();
        const observedPort = address && typeof address !== 'string' ? address.port : undefined;
        const origin = process.env.ANDES_PUBLIC_ORIGIN
          ?? (observedPort ? `http://127.0.0.1:${observedPort}` : '');
        const image = `${origin}/brand/share.png`;
        return [{ tag: 'meta', attrs: { property: 'og:image', content: image }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'twitter:image', content: image }, injectTo: 'head' }];
      },
      configureServer(server) {
        if (!target) server.middlewares.use(unconfiguredApi);
      },
      configurePreviewServer(server) { if (!target) server.middlewares.use(unconfiguredApi); },
    }],
    define: { __ANDES_TEST_HOOKS__: JSON.stringify(mode === 'development' && process.env.ANDES_ENABLE_TEST_HOOKS === '1') },
    server: { port, strictPort: true, proxy },
    preview: { port, strictPort: true, proxy },
    build: { target: 'es2022', sourcemap: false },
  };
});
