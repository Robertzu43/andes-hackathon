import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../src/foundation/index.ts';
import { createPhoneRoutes } from '../../src/app/phone-routes.tsx';
import type { PhoneDemoRuntime } from '../../src/app/runtime.ts';

const tripId = '11111111-1111-4111-8111-111111111111';

function findButton(node: Node & { childNodes?: Node[]; getAttribute?: (name: string) => string | null }): HTMLElement | undefined {
  if (node.getAttribute?.('data-action') === 'start-contact') return node as HTMLElement;
  for (const child of node.childNodes ?? []) {
    const found = findButton(child as Node & { childNodes?: Node[]; getAttribute?: (name: string) => string | null });
    if (found) return found;
  }
  return undefined;
}

/** Render the family contact route. The gate is what a signed-out contact sees. */
export async function renderContactGate(runtime: PhoneDemoRuntime) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const page = createPhoneRoutes(runtime).contactTrip;
  if (!page) throw new Error('contactTrip route is not mounted');
  await act(async () => {
    root.render(createElement(I18nProvider, { initialLocale: 'es' },
      createElement(page, { params: { tripId } })));
  });
  return {
    text: () => host.textContent ?? '',
    button: () => {
      const button = findButton(host);
      if (!button) throw new Error('missing start-contact');
      return button;
    },
    click: async () => {
      const button = findButton(host);
      if (!button) throw new Error('missing start-contact');
      await act(async () => { button.click(); });
    },
    unmount: async () => { await act(async () => { root.unmount(); }); host.remove(); },
  };
}
