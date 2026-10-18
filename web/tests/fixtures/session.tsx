// UI state simulation, no credentials, API or identity bypass. Excluded from production entries.
import { createRoot } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppShell, I18nProvider, SelectField, SessionAccess, useI18n, type SessionGateway, type SessionSnapshot } from '../../src/foundation/index.ts';
import '../../src/styles/tokens.css';
import '../../src/styles/foundation.css';

let snapshot: SessionSnapshot = Object.freeze({ state: 'signed-out', mode: 'demo' });
let attempts = 0;
const listeners = new Set<() => void>();
function set(state: SessionSnapshot['state']) { snapshot = Object.freeze({ state, mode: 'demo' }); for (const listener of listeners) listener(); }
const gateway: SessionGateway = {
  getSnapshot: () => snapshot,
  subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async begin() { if (snapshot.state === 'connecting') return; attempts++; set('connecting'); await new Promise(resolve => setTimeout(resolve, 150)); set('authenticated'); },
  end: () => set('signed-out'),
};
function SessionFixture() {
  const { locale } = useI18n(); const current = useSyncExternalStore(gateway.subscribe, gateway.getSnapshot);
  const labels = locale === 'es'
    ? { label:'Estado de la cuenta de ejemplo', unconfigured:'Sin acceso configurado', 'signed-out':'Sin conexión', connecting:'Conectando', authenticated:'Conectada', expired:'Acceso caducado', error:'Error' }
    : { label:'Estado da conta de exemplo', unconfigured:'Sem acesso configurado', 'signed-out':'Desconectada', connecting:'Conectando', authenticated:'Conectada', expired:'Acesso expirado', error:'Erro' };
  return <AppShell session={gateway}><SelectField id="fixture-session-state" label={labels.label} value={current.state}
    onChange={event => set(event.target.value as SessionSnapshot['state'])}>
    {(['unconfigured','signed-out','connecting','authenticated','expired','error'] as const).map(state => <option value={state} key={state}>{labels[state]}</option>)}
  </SelectField><span data-testid="session-attempts" data-count={attempts} />
  <SessionAccess gateway={gateway} /></AppShell>;
}
createRoot(document.getElementById('root')!).render(<I18nProvider><BrowserRouter><SessionFixture /></BrowserRouter></I18nProvider>);
