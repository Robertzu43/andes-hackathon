import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { visualShell } from '../../../src/visuals/integration/shell.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const localeOf = params => params.get('locale') === 'pt-BR' ? 'pt-BR' : 'es';

export function fixtureHtml(params) {
  const locale = localeOf(params), kind = params.get('kind') === 'relay' ? 'relay' : 'phone';
  const shell = visualShell({ id: 'help', locale, kind });
  const pt = locale === 'pt-BR';
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
    <link rel="icon" href="data:,"><title>ANDES · ${pt ? 'Demonstração visual' : 'Demostración visual'}</title>
    <link rel="stylesheet" href="/src/visuals/integration/visual.css">
    <style>body{margin:0;background:#f2f6f6;color:#173139;font:16px/1.5 system-ui,sans-serif}
    main{max-width:800px;margin:auto;padding:24px}h1{font-size:1.875rem;line-height:1.2}
    a{color:#166675;display:inline-block;min-height:44px}section{margin-top:36px}label{display:block}
    select{font:inherit;min-height:44px;padding:8px;border:1px solid #173139;border-radius:6px;background:#fcfdfd;color:#173139}
    :focus-visible{outline:3px solid #166675;outline-offset:3px}#spacing{height:0}</style></head><body>
    <main><p>${pt ? 'Demonstração local · Sem dados de viagem' : 'Demostración local · Sin datos de viaje'}</p>
    <h1>${pt ? 'Prepare sua viagem' : 'Prepara tu viaje'}</h1>
    <p>${pt ? 'Esta página testa apenas a explicação opcional.' : 'Esta página prueba solo la explicación opcional.'}</p>
    <a id="primary-action" href="#primary-result">${pt ? 'Ver ação de exemplo' : 'Ver acción de ejemplo'}</a>
    <p id="primary-result">${pt ? 'Nenhuma solicitação é enviada.' : 'No se envía ninguna solicitud.'}</p>
    <label>${pt ? 'Idioma' : 'Idioma'} <select id="locale"><option value="es" ${pt ? '' : 'selected'}>Español</option><option value="pt-BR" ${pt ? 'selected' : ''}>Português (BR)</option></select></label>
    <div id="spacing"></div><section aria-label="${pt ? 'Explicação opcional' : 'Explicación opcional'}"><h2>${pt ? 'Ajuda para preparar a viagem' : 'Ayuda para preparar el viaje'}</h2>${shell}</section>
    </main><script type="module" src="/tests/visuals/integration/fixture-page.ts"></script></body></html>`;
}

export function createFixtureServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixtureHtml(url.searchParams)); return; }
    const pathname = resolve(root, '.' + url.pathname);
    const allowed = ['src/visuals/integration/', 'tests/visuals/integration/'].some(dir => pathname.startsWith(resolve(root, dir) + sep));
    if (!allowed || !/\.(ts|css)$/.test(pathname)) { res.writeHead(404); res.end(); return; }
    try {
      const source = await readFile(pathname, 'utf8');
      res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(pathname.endsWith('.ts') ? stripTypeScriptTypes(source) : source);
    } catch { res.writeHead(404); res.end(); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.VISUAL_FIXTURE_PORT ?? 3055);
  const server = createFixtureServer();
  server.listen(port, '127.0.0.1', () => console.log(`Visual integration fixture ready at http://localhost:${port}`));
}
