import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
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
