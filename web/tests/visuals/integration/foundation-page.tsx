import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link } from 'react-router-dom';
import { FoundationRoot, PrimaryAction, useI18n, type SessionGateway, type SessionSnapshot } from '../../../src/foundation/index.ts';
import { OptionalVisual } from '../../../src/visuals/integration/react.ts';
import type { VisualKind, VisualLocale } from '../../../src/visuals/integration/contract.ts';
import '../../../src/styles/tokens.css';
import '../../../src/styles/foundation.css';

const snapshot: SessionSnapshot = Object.freeze({ state: 'unconfigured', mode: 'demo' });
const session: SessionGateway = { getSnapshot: () => snapshot, subscribe: () => () => {} };
let loads = 0;
const loadFixture = () => {
  document.body.dataset.fixtureLoads = String(++loads);
  return import('./fixture-module.ts');
};
const failFixture = async () => { throw new Error('Synthetic optional-module failure'); };
const loadPhone = () => import('andes-reviewed-phone');
const loadRelay = () => import('andes-reviewed-relay');
const query = new URLSearchParams(location.search);
const initialLocale: VisualLocale = query.get('locale') === 'pt-BR' ? 'pt-BR' : 'es';
const kind: VisualKind = query.get('art') === 'relay' || query.get('kind') === 'relay' ? 'relay' : 'phone';
const load = query.has('failure') ? failFixture : query.get('art') === 'phone' ? loadPhone : query.get('art') === 'relay' ? loadRelay : loadFixture;
const copy = {
  es: {
    title: 'Tu viaje', note: 'Prueba local del montaje visual. No hay un viaje ni se envía una solicitud.',
    action: 'Probar acción local', result: 'Acciones locales', help: 'Ayuda opcional, solo cuando estés detenido',
    disclosure: 'Ver explicación', remove: 'Retirar ilustración de prueba', restore: 'Restaurar ilustración de prueba',
    contact: 'Ir a contactos de prueba', contacts: 'Contactos de prueba', back: 'Volver a la prueba del viaje',
  },
  'pt-BR': {
    title: 'Sua viagem', note: 'Teste local da montagem visual. Não há uma viagem e nenhuma solicitação é enviada.',
    action: 'Testar ação local', result: 'Ações locais', help: 'Ajuda opcional, apenas quando estiver parado',
    disclosure: 'Ver explicação', remove: 'Remover ilustração de teste', restore: 'Restaurar ilustração de teste',
    contact: 'Ir para contatos de teste', contacts: 'Contatos de teste', back: 'Voltar ao teste da viagem',
  },
};

function HelpFixture() {
  const { locale } = useI18n();
  const t = copy[locale];
  const [count, setCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(true);
  return <>
    <h1>{t.title}</h1><p className="andes-prose">{t.note}</p>
    <PrimaryAction id="primary-action" onClick={() => setCount(value => value + 1)}>{t.action}</PrimaryAction>
    <p id="primary-result" role="status">{t.result}: {count}</p>
    <Link id="route-away" to="/contacts">{t.contact}</Link>
    <section className="andes-section andes-secondary-section" aria-labelledby="visual-help-title">
      <h2 id="visual-help-title">{t.help}</h2>
      <details onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary id="visual-disclosure" style={{ minHeight: 44, cursor: 'pointer' }}>{t.disclosure}</summary>
        {expanded && <>
          <PrimaryAction id="mount-toggle" tone="secondary" onClick={() => setPresent(value => !value)}>{present ? t.remove : t.restore}</PrimaryAction>
          {present && <OptionalVisual id="foundation-visual" locale={locale} kind={kind} load={load} />}
        </>}
      </details>
    </section>
  </>;
}
function ContactsFixture() {
  const { locale } = useI18n(); const t = copy[locale];
  return <><h1>{t.contacts}</h1><p>{t.note}</p><Link id="route-back" to="/">{t.back}</Link></>;
}
// One actual shared shell/router/provider. This entry is an isolated fixture only.
createRoot(document.getElementById('root')!).render(<StrictMode>
  <FoundationRoot initialLocale={initialLocale} session={session} routes={{ home: HelpFixture, contacts: ContactsFixture }} />
</StrictMode>);
