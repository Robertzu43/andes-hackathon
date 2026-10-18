// Development-only counterexamples. No accounts, credentials, writes or provider calls.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AttributedUpdate, FactRow, Field, FoundationRoot, PrimaryAction, useI18n,
  type FeatureRoutes, type SessionGateway, type SessionSnapshot } from '../../src/foundation/index.ts';
import '../../src/styles/tokens.css';
import '../../src/styles/foundation.css';

const scenario = new URL(location.href).searchParams.get('case') ?? 'facts';
class ClassGateway implements SessionGateway {
  private value: SessionSnapshot = Object.freeze({ state: 'signed-out', mode: 'demo' });
  private listeners = new Set<() => void>();
  getSnapshot() { return this.value; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async begin() { this.value = Object.freeze({ state: 'authenticated', mode: 'demo' }); for (const listener of this.listeners) listener(); }
  end() { this.value = Object.freeze({ state: 'signed-out', mode: 'demo' }); for (const listener of this.listeners) listener(); }
}
function ThrowingRoute(): never { throw new Error('Synthetic route failure; never render this message'); }
function Facts() {
  return <><h1>Datos de ejemplo</h1><p>Esta prueba no envía información.</p><dl>
    <FactRow label="zero" timestamp="0">Ejemplo</FactRow>
    <FactRow label="loose" timestamp="hello 5">Ejemplo</FactRow>
    <FactRow label="no-zone" timestamp="2026-10-17T12:00:00">Ejemplo</FactRow>
    <FactRow label="invalid-calendar" timestamp="2026-02-30T12:00:00Z">Ejemplo</FactRow>
    <FactRow label="valid" timestamp="2026-10-17T12:00:00Z">Ejemplo</FactRow>
    <FactRow label="captured-zone" timestamp="2026-10-17T12:00:00Z" timeZone="America/Lima" timestampKind="captured">Ejemplo</FactRow>
    <FactRow label="received-zone" timestamp="2026-10-17T12:01:00Z" timeZone="America/Lima" timestampKind="received">Ejemplo</FactRow>
  </dl><div data-review="attributed"><AttributedUpdate source="Persona de ejemplo" timestamp="2026-10-17T12:00:00Z">Respuesta de ejemplo</AttributedUpdate></div></>;
}
function Focus() {
  return <><h1>Entrada de ejemplo</h1><Field id="feature-input" label="Nombre" autoFocus />
    <div style={{ height: 1800 }} aria-hidden="true" /></>;
}
function Trip() { const { t } = useI18n(); return <h1>{t('activeTrip')}</h1>; }
function CriticalAction() {
  const [count, setCount] = useState(0);
  return <><PrimaryAction data-review-critical onClick={() => setCount(n => n + 1)}>Acción de prueba sin envío</PrimaryAction><output data-review-count aria-live="polite">{count}</output></>;
}
const routes: FeatureRoutes = { home: Facts, trucks: ['throw-route','critical-route'].includes(scenario) ? ThrowingRoute : Focus, activeTrip: Trip };
let snapshot: SessionSnapshot = Object.freeze({ state: 'signed-out', mode: 'demo' });
const listeners = new Set<() => void>();
const failedGateway: SessionGateway = {
  getSnapshot: () => snapshot,
  subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async begin() { throw new Error('Synthetic acquisition failure'); },
  end() { snapshot = Object.freeze({ state: 'signed-out', mode: 'demo' }); for (const listener of listeners) listener(); },
};
window.__FOUNDATION_REVIEW_AUTHENTICATE__ = () => {
  snapshot = Object.freeze({ state: 'authenticated', mode: 'demo' }); for (const listener of listeners) listener();
};
const gateway = scenario === 'class-gateway' ? new ClassGateway() : scenario === 'failed-alert' ? failedGateway
  : scenario === 'throw-gateway' ? { getSnapshot(): never { throw new Error('Synthetic gateway failure'); }, subscribe: () => () => {} } : undefined;
const path = ['class-gateway', 'failed-alert', 'throw-gateway'].includes(scenario) ? '/session'
  : ['focus','throw-route','critical-route'].includes(scenario) ? '/trucks'
    : scenario === 'trip' ? '/trips/11111111-1111-4111-8111-111111111111' : '/';
history.replaceState({}, '', path);
window.__FOUNDATION_REVIEW_LOADED__ = scenario;
createRoot(document.getElementById('root')!).render(<FoundationRoot session={gateway} routes={routes} criticalActions={scenario === 'critical-route' ? <CriticalAction /> : undefined} />);
declare global { interface Window { __FOUNDATION_REVIEW_AUTHENTICATE__?: () => void; __FOUNDATION_REVIEW_LOADED__?: string } }
