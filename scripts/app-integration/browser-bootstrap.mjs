// Test-only virtual module served by the fixture's dev server, never a production entry.
// Root-relative import: the checkout's own client in web/src/lib/api.
import {MemorySession, createApiClient, createSessionGateway} from '/src/lib/api/index.ts';

export function mountSession() {
  if (typeof window.__ANDES_TEST_MOUNT__ !== 'function') throw Error('Development fixture hook required');
  const session = new MemorySession();
  const api = createApiClient({baseUrl: location.origin, session});
  const gateway = createSessionGateway({session, api, mode: 'demo', acquire: async ({signal}) => {
    const response = await fetch('/__andes_fixture__/credentials', {
      method: 'POST', headers: {'X-Andes-Fixture': 'synthetic-only'}, signal,
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (response.status !== 200) throw Error('Synthetic credential fixture unavailable');
    return response.json();
  }});
  window.__ANDES_TEST_MOUNT__({session: gateway, initialLocale: 'es'});
  return {getSnapshot: gateway.getSnapshot, dispose: gateway.dispose};
}
