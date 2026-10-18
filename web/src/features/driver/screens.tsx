import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Field, PrimaryAction, useI18n, useMessages } from '../../foundation/index.ts';
import { formattedTimestamp } from '../../foundation/time.ts';
import type { DriverJourney, JourneySnapshot } from './controller.mjs';
import { driverMessages, type DriverMessage } from './messages.ts';
import { contactMessages } from '../contacts/messages.ts';
import type { PhoneDemoRuntime } from '../../app/runtime.ts';
import type { Bootstrap, TripStatus } from '../../lib/api/index.ts';

function useJourney(journey: DriverJourney) {
  const cache = useRef(journey.snapshot());
  const subscribe = useCallback((onChange: () => void) => journey.subscribe(view => {
    cache.current = view;
    onChange();
  }), [journey]);
  const get = useCallback(() => cache.current, []);
  return useSyncExternalStore(subscribe, get, get);
}
function useGateway(gateway: PhoneDemoRuntime['gateway']) {
  const cache = useRef(gateway.getSnapshot());
  const subscribe = useCallback((onChange: () => void) => gateway.subscribe(() => {
    cache.current = gateway.getSnapshot();
    onChange();
  }), [gateway]);
  const get = useCallback(() => cache.current, []);
  return useSyncExternalStore(subscribe, get, get);
}
function futureArrival(from = new Date()): string {
  const date = new Date(from.getTime() + 4 * 60 * 60 * 1000);
  const pad = (value: number) => String(Math.trunc(Math.abs(value))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
function statusOf(view: JourneySnapshot): TripStatus | null {
  const data = view.status.data as unknown as TripStatus | null;
  return data && Array.isArray(data.deliveries) ? data : null;
}
function Note({ code }: { code: DriverMessage | null }) {
  const t = useMessages(driverMessages);
  if (!code) return null;
  return <p role="alert" data-outcome={code}>{t(code)}</p>;
}
function useTrip(runtime: PhoneDemoRuntime, tripId: string) {
  const view = useJourney(runtime.journey);
  useEffect(() => {
    if (view.auth.state !== 'authenticated' || view.tripId === tripId.toLowerCase() || view.tripId) return;
    void runtime.journey.openTrip(tripId);
  }, [runtime, tripId, view.auth.state, view.tripId]);
  useEffect(() => {
    if (view.tripId !== tripId.toLowerCase()) return;
    const tick = () => { void runtime.journey.refreshStatus(); };
    tick();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [runtime, tripId, view.tripId]);
  return view;
}
function Deliveries({ rows }: { rows: TripStatus['deliveries'] }) {
  const { locale } = useI18n();
  const copy = contactMessages[locale];
  if (rows.length === 0) return <p>{copy.deliveriesNoneVisible}</p>;
  return <ul className="andes-contact-deliveries">{rows.map((row, index) => <li key={index}>
    {copy[row.role]} · {copy[`channel_${row.channel}`]}: {copy[`delivery_${row.status}`]}
  </li>)}</ul>;
}

export function Home({ runtime }: { runtime: PhoneDemoRuntime }) {
  const t = useMessages(driverMessages);
  const session = useGateway(runtime.gateway);
  const view = useJourney(runtime.journey);
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const starting = useRef(false);
  async function start() {
    if (!runtime.gateway.begin || starting.current || runtime.gateway.getSnapshot().state === 'connecting') return;
    starting.current = true;
    setBusy(true); setFailed(false);
    try {
      await runtime.gateway.begin();
      if (runtime.gateway.getSnapshot().state === 'authenticated') navigate('/trips/new');
    }
    catch { setFailed(true); }
    finally { starting.current = false; setBusy(false); }
  }
  const next = view.tripId ? `/trips/${view.tripId}/check-in` : '/trips/new';
  return <section className="tandem-flow"><h1>{t('welcomeTitle')}</h1><p>{t('welcomeBody')}</p>
    {session.state === 'authenticated' ? <>
      <p>{t('signedIn')}</p>
      <Link className="andes-button andes-button--primary" to={next}>{view.tripId ? t('openCheck') : t('register')}</Link>
    </> : <>
      {(failed || session.state === 'error') && <p role="alert">{t('startFailed')}</p>}
      {session.state === 'expired' && <p role="alert">{t('sessionExpired')}</p>}
      <PrimaryAction data-action="start-demo" busy={busy || session.state === 'connecting'} onClick={() => void start()}>{t('start')}</PrimaryAction>
    </>}</section>;
}

export function Trucks({ runtime }: { runtime: PhoneDemoRuntime }) {
  const t = useMessages(driverMessages);
  const view = useJourney(runtime.journey);
  const truck = view.selection?.trucks[0];
  return <section className="tandem-flow"><h1>{t('truckTitle')}</h1>
    <p>{truck ? `${t('truckLabel')}: ${truck.label}` : t('truckBody')}</p>
    <Link to="/trips/new">{t('register')}</Link></section>;
}

export function Prepare({ runtime }: { runtime: PhoneDemoRuntime }) {
  const t = useMessages(driverMessages);
  const { locale } = useI18n();
  const session = useGateway(runtime.gateway);
  const view = useJourney(runtime.journey);
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<Bootstrap | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<DriverMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [text, setText] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [arrival] = useState(futureArrival);
  function evidence(boot: Bootstrap) {
    const actorId = runtime.journey.snapshot().auth.actorId;
    if (!actorId) return false;
    return runtime.journey.provideSelectionEvidence({
      actorId, source: 'authenticated-server-read', readAt: boot.readAt,
      trucks: boot.trucks.map(truck => ({ id: truck.id, label: truck.label })),
      contacts: boot.contacts.map(contact => ({ id: contact.id, status: contact.status,
        map: contact.map.accepted, incident: contact.incident.accepted })),
    }).kind !== 'blocked';
  }
  function grants(boot: Bootstrap, intendedFamily = familyId) {
    const family = boot.contacts.find(contact => contact.contactId === intendedFamily && contact.role === 'family'
      && contact.status === 'accepted' && contact.incident.accepted);
    if (!family) return null;
    return boot.contacts.filter(contact => contact.status === 'accepted'
      && (contact.id === family.id || contact.role === 'colleague')
      && (contact.map.accepted || contact.incident.accepted)).map(contact => contact.id);
  }
  useEffect(() => {
    if (session.state !== 'authenticated') return;
    let cancel = false;
    void (async () => {
      try {
        await runtime.binding.activate();
        runtime.journey.setNetwork(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online');
        const { world } = await runtime.world.get();
        const boot = await runtime.api.getBootstrap();
        if (cancel) return;
        setFamilyId(world.family.id);
        if (!evidence(boot)) { setFailure('blocked'); return; }
        setCatalog(boot); setFailure(grants(boot, world.family.id) ? null : 'contactWaiting');
      } catch { if (!cancel) setFailure('unavailable'); }
    })();
    return () => { cancel = true; };
  }, [runtime, session.state]);
  async function refreshCatalog() {
    const boot = await runtime.api.getBootstrap();
    setCatalog(boot);
    if (!evidence(boot)) { setFailure('blocked'); return null; }
    const selected = grants(boot);
    if (!selected) setFailure('contactWaiting');
    return selected;
  }
  function goToTrip() {
    const id = runtime.journey.snapshot().tripId;
    if (id) navigate(`/trips/${id}/check-in`);
  }
  async function confirmSaved(unknown = false) {
    // Re-read consent immediately before every explicit confirmation. Unknown intent is immutable.
    const selected = await refreshCatalog();
    if (!selected) return;
    if (unknown) {
      const original = runtime.journey.snapshot().operations.confirm?.request.body?.contactGrantIds;
      if (!Array.isArray(original) || original.some(id => typeof id !== 'string' || !selected.includes(id))
        || !original.some(id => catalog?.contacts.some(c => c.id === id && c.contactId === familyId))) {
        setFailure('contactWaiting'); return;
      }
    } else if (runtime.journey.selectContacts(selected).kind === 'blocked') { setFailure('blocked'); return; }
    const result = unknown ? await runtime.journey.retryUnknown('confirm', { confirmed: true })
      : await runtime.journey.confirmTrip({ confirmed: true });
    if (result.kind === 'ok') { goToTrip(); return; }
    setFailure(result.kind === 'rejected' && result.code === 'contact_not_accepted' ? 'contactWaiting'
      : result.kind === 'rejected' ? 'rejected' : result.kind === 'unknown' ? 'unknownWrite'
      : result.kind === 'not_sent' ? 'notSent' : 'blocked');
  }
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(null);
    try { await action(); } catch { setFailure('unavailable'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    await run(async () => {
      // A saved draft is recovered only through the explicit actions below.
      if (runtime.journey.snapshot().draft || !catalog) return;
      const selected = await refreshCatalog();
      if (!selected) return;
      const truck = catalog.trucks[0];
      if (!truck || runtime.journey.snapshot().interaction !== 'stationary') { setFailure('blocked'); return; }
      const edited = runtime.journey.editForm({ text: text.trim(), fields: {
        truckId: truck.id, origin: origin.trim(), destination: destination.trim(),
        country: 'PE', locale: 'es', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        expectedArrivalAt: arrival,
      } });
      if (edited.kind === 'blocked' || runtime.journey.selectContacts(selected).kind === 'blocked') { setFailure('blocked'); return; }
      const draft = await runtime.journey.saveDraft();
      if (draft.kind !== 'ok') { setFailure(draft.kind === 'rejected' ? 'rejected' : draft.kind === 'unknown' ? 'unknownWrite' : 'blocked'); return; }
      await confirmSaved();
    });
  }
  if (session.state !== 'authenticated') return <section className="tandem-flow"><h1>{t('prepareTitle')}</h1>
    <p>{t('reloadBody')}</p><Link to="/">{t('startOver')}</Link></section>;
  const unknown = view.operations.confirm?.state === 'unknown';
  return <section className="tandem-flow"><h1>{t('prepareTitle')}</h1>
    <p>{catalog && grants(catalog) && failure !== 'contactWaiting' ? t('contactsReady') : t('contactWaiting')}</p>
    {!catalog && !failure ? <p role="status">{t('loading')}</p> : view.draft ? <>
      <p>{t('savedDraft')}</p>
      <p>{view.draft.fields.origin} → {view.draft.fields.destination}</p>
      <Note code={failure} />
      {unknown ? <>
        {failure !== 'unknownWrite' && <p>{t('unknownWrite')}</p>}
        <PrimaryAction data-action="reconcile-confirm" busy={busy} onClick={() => void run(async () => {
          const result = await runtime.journey.openTrip(view.draft!.id);
          if (result.kind === 'ok') goToTrip(); else setFailure('unknownWrite');
        })}>{t('reconcileConfirm')}</PrimaryAction>
        <PrimaryAction data-action="retry-unknown-confirm" tone="secondary" busy={busy}
          onClick={() => void run(() => confirmSaved(true))}>{t('retryUnknownConfirm')}</PrimaryAction>
      </> : <PrimaryAction data-action="retry-confirm" busy={busy}
        onClick={() => void run(() => confirmSaved())}>{t('retryConfirm')}</PrimaryAction>}
    </> : <form onSubmit={event => void submit(event)}>
      <p>{t('truckLabel')}: {catalog?.trucks[0]?.label ?? t('truckBody')}</p>
      <p>{t('countryHint')}</p>
      <p>{t('arrivalLabel')}: <time dateTime={arrival}>{formattedTimestamp(arrival, locale) ?? arrival}</time></p>
      <label className="tandem-stop"><input data-action="im-stopped" type="checkbox" checked={view.interaction === 'stationary'}
        onChange={event => { runtime.journey.setInteractionMode(event.target.checked ? 'stationary' : 'unknown'); }} />
        <span>{t('stopped')}</span></label>
      <p className="andes-hint">{t('stoppedHint')}</p>
      <Field id="trip-text" label={t('description')} value={text} onChange={event => setText(event.target.value)} autoComplete="off" />
      <Field id="trip-origin" label={t('origin')} value={origin} onChange={event => setOrigin(event.target.value)} autoComplete="off" />
      <Field id="trip-destination" label={t('destination')} value={destination} onChange={event => setDestination(event.target.value)} autoComplete="off" />
      <Note code={failure} />
      <PrimaryAction data-action="confirm-trip" type="submit" busy={busy}>{t('confirm')}</PrimaryAction>
    </form>}</section>;
}

function TripBody({ runtime, view, tripId, mode }: { runtime: PhoneDemoRuntime; view: JourneySnapshot; tripId: string; mode: 'active' | 'checkin' | 'alerts' | 'summary' }) {
  const t = useMessages(driverMessages);
  const { locale } = useI18n();
  const sos = view.operations.sos;
  const command = view.operations.command;
  const status = statusOf(view);
  const check = status?.check ?? null;
  const title = mode === 'checkin' ? 'checkTitle' : mode === 'alerts' ? 'alertsTitle' : mode === 'summary' ? 'summaryTitle' : 'tripTitle';
  if (view.auth.state !== 'authenticated' && !view.tripId) return <section className="tandem-flow"><h1>{t('reloadTitle')}</h1>
    <p>{t('reloadBody')}</p><Link to="/">{t('startOver')}</Link></section>;
  if (view.tripId !== tripId.toLowerCase()) return <section className="tandem-flow"><h1>{t('reloadTitle')}</h1>
    <p role="alert">{t(view.tripId ? 'tripMismatch' : 'tripLoading')}</p>
    {view.tripId && <Link data-action="bound-trip" to={`/trips/${view.tripId}/check-in`}>{t('openCheck')}</Link>}
  </section>;
  const current = view.status.state === 'available' && !view.status.invalidated && !view.status.error && status !== null;
  const statusState = current ? 'current' : status ? 'stale' : 'unknown';
  const readAt = view.status.clientReceivedAtMs === null ? null : new Date(view.status.clientReceivedAtMs).toISOString();
  return <section className="tandem-flow" data-trip-id={tripId}><h1>{t(title)}</h1>
    <div data-status-state={statusState} role="status">
      {!current && <p>{t(status ? 'statusStale' : 'statusUnknown')}</p>}
      {readAt && <p>{t('statusReadAt')} <time dateTime={readAt}>{formattedTimestamp(readAt, locale) ?? readAt}</time></p>}
    </div>
    {mode === 'summary' ? <p>{t('summaryBody')}</p> : <>
      {current && (check ? <p role="status">{t('checkOpen')} <time dateTime={check.askUntil}>{formattedTimestamp(check.askUntil, locale) ?? check.askUntil}</time></p>
        : <p>{t('noCheck')}</p>)}
      <div className="tandem-sos"><PrimaryAction data-action="sos" tone="danger" busy={sos?.state === 'pending'} onClick={() => void runtime.journey.requestHelp()}>{t('sos')}</PrimaryAction></div>
      <p className="andes-hint">{t('sosHint')}</p>
      <PrimaryAction data-action="checkin-ok" data-command-state={command?.state ?? 'idle'} tone="secondary" busy={command?.state === 'pending'}
        onClick={() => void runtime.journey.sendCommand('checkin_ok')}>{t('ok')}</PrimaryAction>
      <p className="andes-hint">{t('okHint')}</p>
    </>}
    {view.incident.data?.status === 'active' && <p>{t('summaryOpenIncident')}</p>}
    {sos?.state === 'accepted' && <p data-alert-state="recorded">{t('alertRecorded')}</p>}
    {(sos?.state === 'unknown' || command?.state === 'unknown') && <Note code="unknownWrite" />}
    {(sos?.state === 'rejected' || command?.state === 'rejected') && <Note code="rejected" />}
    <p data-delivery-honesty>{t('alertHonesty')}</p>
    {mode === 'alerts' && current && <Deliveries rows={status.deliveries} />}
    {view.tripId && mode !== 'checkin' && <Link data-action="open-checkin" to={`/trips/${view.tripId}/check-in`}>{t('openCheck')}</Link>}
    {view.tripId && mode !== 'alerts' && <Link to={`/trips/${view.tripId}/alerts`}>{t('alertsLink')}</Link>}
    {view.tripId && <Link data-action="open-contact" to={`/contact/trips/${view.tripId}`}>{t('contactView')}</Link>}
  </section>;
}
export function TripHome({ runtime, tripId }: { runtime: PhoneDemoRuntime; tripId: string }) {
  return <TripBody runtime={runtime} view={useTrip(runtime, tripId)} tripId={tripId} mode="active" />;
}
export function CheckIn({ runtime, tripId }: { runtime: PhoneDemoRuntime; tripId: string }) {
  return <TripBody runtime={runtime} view={useTrip(runtime, tripId)} tripId={tripId} mode="checkin" />;
}
export function Alerts({ runtime, tripId }: { runtime: PhoneDemoRuntime; tripId: string }) {
  return <TripBody runtime={runtime} view={useTrip(runtime, tripId)} tripId={tripId} mode="alerts" />;
}
export function Summary({ runtime, tripId }: { runtime: PhoneDemoRuntime; tripId: string }) {
  return <TripBody runtime={runtime} view={useTrip(runtime, tripId)} tripId={tripId} mode="summary" />;
}
