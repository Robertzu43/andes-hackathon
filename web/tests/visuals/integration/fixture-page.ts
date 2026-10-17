import { mountVisualHost } from '../../../src/visuals/integration/host.ts';
import type { VisualKind, VisualLocale } from '../../../src/visuals/integration/contract.ts';

const params = new URLSearchParams(location.search);
const locale: VisualLocale = params.get('locale') === 'pt-BR' ? 'pt-BR' : 'es';
const kind: VisualKind = params.get('kind') === 'relay' ? 'relay' : 'phone';
const root = document.querySelector<HTMLElement>('[data-visual]')!;
if (params.has('offscreen')) document.querySelector<HTMLElement>('#spacing')!.style.height = '1500px';
const select = document.querySelector<HTMLSelectElement>('#locale')!;
select.addEventListener('change', () => { params.set('locale', select.value); location.search = params.toString(); });
let imports = 0;
const handle = mountVisualHost(root, { locale, kind, load: async () => {
  root.dataset.imports = String(++imports);
  if (params.has('failure')) throw new Error('Synthetic import failure');
  return import('./fixture-module.ts');
} });
Object.assign(window, { visualFixture: { handle, root } });
