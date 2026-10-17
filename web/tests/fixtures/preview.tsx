// Local component fixture only; not an entry in the production build.
import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider, AppShell, useI18n, PrimaryAction, ActionGroup, Field, SelectField, ConsentScope,
  TripIdentity, FactRow, AttributedUpdate, AsyncState, PermissionState, ErrorRecovery } from '../../src/foundation/index.ts';
import '../../src/styles/tokens.css';
import '../../src/styles/foundation.css';
const texts = {
  es: { title: 'Demostración de controles', intro: 'Datos de ejemplo. Esta página no conecta cuentas ni envía información.',
    state: 'Estado del ejemplo', ready: 'Información disponible', loading: 'Cargando', empty: 'Sin información', error: 'Error', permission: 'Permiso denegado', long: 'Texto largo',
    response: 'Última respuesta', location: 'Última ubicación', deadline: 'Acuerdo del servidor', channel: 'Estado del aviso', unknown: 'Sin información',
    report: 'El conductor indicó que iba a descansar.', source: 'Conductor de ejemplo', name: 'Nombre del camión',
    hint: 'Usa una etiqueta que reconozcas.', required: 'Escribe una etiqueta para continuar.', scope: 'Permisos del ejemplo',
    map: 'Compartir ubicación', incident: 'Compartir solicitudes de ayuda', save: 'Guardar ejemplo', saving: 'Guardando…',
    saved: 'Ejemplo guardado. No se envió información.', denied: 'La ubicación no está disponible',
    deniedBody: 'Puedes revisar el permiso de ubicación en los ajustes de tu teléfono.', retry: 'Volver a intentar',
    longBody: 'No tenemos una nueva ubicación. La última información conserva la hora en que se registró. Recibirla de nuevo no confirma la ubicación actual ni explica la falta de información.',
  },
  'pt-BR': { title: 'Demonstração de controles', intro: 'Dados de exemplo. Esta página não conecta contas nem envia informações.',
    state: 'Estado do exemplo', ready: 'Informação disponível', loading: 'Carregando', empty: 'Sem informação', error: 'Erro', permission: 'Permissão negada', long: 'Texto longo',
    response: 'Última resposta', location: 'Última localização', deadline: 'Acordo do servidor', channel: 'Estado do aviso', unknown: 'Sem informação',
    report: 'O motorista informou que ia descansar.', source: 'Motorista de exemplo', name: 'Nome do caminhão',
    hint: 'Use uma identificação que você reconheça.', required: 'Digite uma identificação para continuar.', scope: 'Permissões do exemplo',
    map: 'Compartilhar localização', incident: 'Compartilhar pedidos de ajuda', save: 'Salvar exemplo', saving: 'Salvando…',
    saved: 'Exemplo salvo. Nenhuma informação foi enviada.', denied: 'A localização não está disponível',
    deniedBody: 'Você pode conferir a permissão de localização nas configurações do celular.', retry: 'Tentar novamente',
    longBody: 'Não temos uma nova localização. A última informação mantém o horário em que foi registrada. Recebê-la novamente não confirma a localização atual nem explica a falta de informação.',
  },
};
function Preview() {
  const { locale } = useI18n(); const t = texts[locale];
  const [state, setState] = useState('ready'); const [value, setValue] = useState(''); const [error, setError] = useState(false);
  const [map, setMap] = useState(false); const [incident, setIncident] = useState(false);
  const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(0); const lock = useRef(false);
  return <><h1>{t.title}</h1><p className="andes-prose">{t.intro}</p>
    <section className="andes-section" style={{ marginBlockStart: '2rem' }}>
      <SelectField label={t.state} value={state} onChange={e => setState(e.target.value)} id="fixture-state">
        {(['ready','loading','empty','error','permission','long'] as const).map(s => <option key={s} value={s}>{t[s]}</option>)}
      </SelectField>
      <TripIdentity label="Camión / Caminhão 01" route="Origen de ejemplo → Destino de exemplo" />
      <AsyncState state={state === 'loading' || state === 'empty' || state === 'error' ? state : 'ready'} onRetry={() => setState('ready')}>
        <dl className="andes-fact-list"><FactRow label={t.response} source={t.source} timestamp="2026-10-17T12:00:00Z">{t.report}</FactRow>
          <FactRow label={t.location} source={t.source} timestamp="2026-10-17T11:50:00Z">{state === 'long' ? t.longBody : t.unknown}</FactRow>
          <FactRow label={t.deadline}>{t.unknown}</FactRow><FactRow label={t.channel}>{t.unknown}</FactRow></dl>
      </AsyncState>
      {state === 'permission' && <PermissionState title={t.denied}><p>{t.deniedBody}</p></PermissionState>}
      <AttributedUpdate source={t.source} timestamp="2026-10-17T12:00:00Z">{t.report}</AttributedUpdate>
    </section>
    <form className="andes-section" style={{ marginBlockStart: '2.5rem' }} onSubmit={async e => {
      e.preventDefault(); if (lock.current) return;
      if (!value.trim()) { setError(true); return; }
      lock.current = true; setError(false); setBusy(true);
      await new Promise(resolve => setTimeout(resolve, 150));
      setSaved(n => n + 1); setBusy(false); lock.current = false;
    }}>
      <Field id="fixture-label" label={t.name} hint={t.hint} value={value} onChange={e => setValue(e.target.value)} error={error ? t.required : undefined} />
      <ConsentScope legend={t.scope} options={[{ id:'map', label:t.map, checked:map, onChange:setMap }, { id:'incident', label:t.incident, checked:incident, onChange:setIncident }]} />
      <ActionGroup><PrimaryAction type="submit" busy={busy} busyLabel={t.saving}>{t.save}</PrimaryAction>
        <PrimaryAction disabled tone="secondary">{t.save}</PrimaryAction></ActionGroup>
      {error && <ErrorRecovery title={t.required} />}
      {saved > 0 && <p role="status" data-testid="fixture-saves" data-count={saved}>{t.saved}</p>}
    </form>
  </>;
}
createRoot(document.getElementById('root')!).render(<I18nProvider><BrowserRouter><AppShell><Preview /></AppShell></BrowserRouter></I18nProvider>);
