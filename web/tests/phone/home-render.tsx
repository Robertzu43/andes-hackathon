import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../src/foundation/index.ts';
import { Home } from '../../src/features/driver/screens.tsx';
import { createPhoneRoutes } from '../../src/app/phone-routes.tsx';
import type { PhoneDemoRuntime } from '../../src/app/runtime.ts';

export function renderHome(runtime: PhoneDemoRuntime) {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(I18nProvider, { initialLocale: 'es' }, createElement(Home, { runtime }))));
}
export function phoneRoutes(runtime: PhoneDemoRuntime) {
  return createPhoneRoutes(runtime);
}

// Controlled DOM adapter for focused screen tests; browser input is covered by journey.mjs.
export async function mountPhone(runtime: PhoneDemoRuntime, route: string, params = {}) {
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useLocation } = await import('react-router');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  function Location() { return createElement('output', { 'data-location': true }, useLocation().pathname); }
  function find(predicate: (node: HTMLElement) => boolean, node = host): HTMLElement | undefined {
    if (predicate(node)) return node;
    for (const child of Array.from(node.childNodes)) {
      const found = find(predicate, child as HTMLElement);
      if (found) return found;
    }
    return undefined;
  }
  async function render(next = route, nextParams = params) {
    const page = createPhoneRoutes(runtime)[next as keyof ReturnType<typeof createPhoneRoutes>];
    if (!page) throw new Error(`Missing route ${next}`);
    await act(async () => root.render(createElement(MemoryRouter, { useTransitions: false },
      createElement(I18nProvider, { initialLocale: 'es' }, createElement(page, { params: nextParams }), createElement(Location)))));
  }
  await render();
  return {
    text: () => host.textContent ?? '',
    find,
    render,
    flush: async (fn = () => {}) => { await act(async () => { await fn(); }); },
    action: (name: string) => find(node => node.getAttribute?.('data-action') === name),
    click: async (name: string) => { await act(async () => {
      const node = find(node => node.getAttribute?.('data-action') === name);
      if (!node) throw new Error(`Missing action ${name}`);
      node.click();
    }); },
    submit: async () => { await act(async () => {
      const form = find(node => node.tagName === 'FORM');
      if (!form) throw new Error('Missing form');
      form.dispatchEvent({ type: 'submit', bubbles: true, preventDefault() {}, stopPropagation() {} } as unknown as Event);
    }); },
    fill: async (id: string, value: string) => { await act(async () => {
      const node = find(node => node.getAttribute?.('id') === id);
      if (!node) throw new Error(`Missing field ${id}`);
      const key = Object.keys(node).find(key => key.startsWith('__reactProps$'))!;
      (node as unknown as Record<string, { onChange: (event: unknown) => void }>)[key]!.onChange({ target: { value } });
    }); },
    unmount: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}
