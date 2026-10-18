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
  async function start() {
    if (!runtime.gateway.begin) return;
    setBusy(true); setFailed(false);
    try { await runtime.gateway.begin(); navigate('/trips/new'); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }
  const next = view.tripId ? `/trips/${view.tripId}/check-in` : '/trips/new';
  return <section className="tandem-flow"><h1>{t('welcomeTitle')}</h1><p>{t('welcomeBody')}</p>
    {session.state === 'authenticated' ? <>
      <p>{t('signedIn')}</p>
      <Link className="andes-button andes-button--primary" to={next}>{view.tripId ? t('openCheck') : t('register')}</Link>
    </> : <>
      {failed && <p role="alert">{t('startFailed')}</p>}
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
  const [failure, setFailure] = useState<DriverMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [arrival] = useState(futureArrival);
  useEffect(() => {
    if (session.state !== 'authenticated') return;
    let cancel = false;
    void (async () => {
      try {
        await runtime.binding.activate();
        runtime.journey.setNetwork(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online');
        const boot = await runtime.api.getBootstrap();
        if (cancel) return;
        const actorId = runtime.journey.snapshot().auth.actorId;
        if (!actorId) return;
        const evidence = runtime.journey.provideSelectionEvidence({
          actorId, source: 'authenticated-server-read', readAt: boot.readAt,
          trucks: boot.trucks.map(truck => ({ id: truck.id, label: truck.label })),
          contacts: boot.contacts.map(contact => ({ id: contact.id, status: contact.status,
            map: contact.map.accepted, incident: contact.incident.accepted })),
        });
        if (cancel) return;
        if (evidence.kind === 'blocked') { setFailure('blocked'); return; }
        setCatalog(boot); setFailure(null);
      } catch { if (!cancel) setFailure('unavailable'); }
    })();
    return () => { cancel = true; };
  }, [runtime, session.state]);
  async function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!catalog || busy) return;
    const truck = catalog.trucks[0];
    if (!truck) { setFailure('blocked'); return; }
    if (runtime.journey.snapshot().interaction !== 'stationary') { setFailure('blocked'); return; }
    const edited = runtime.journey.editForm({ text: text.trim(), fields: {
      truckId: truck.id, origin: origin.trim(), destination: destination.trim(),
      country: 'PE', locale: 'es', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      expectedArrivalAt: arrival,
    } });
    if (edited.kind === 'blocked') { setFailure('blocked'); return; }
    const grants = catalog.contacts.filter(contact => contact.status === 'accepted' && (contact.map.accepted || contact.incident.accepted)).map(contact => contact.id);
    if (runtime.journey.selectContacts(grants).kind === 'blocked') { setFailure('blocked'); return; }
    setBusy(true); setFailure(null);
    const draft = await runtime.journey.saveDraft();
    if (draft.kind !== 'ok') { setBusy(false); setFailure(draft.kind === 'rejected' ? 'rejected' : draft.kind === 'unknown' ? 'unknownWrite' : 'blocked'); return; }
    const confirmed = await runtime.journey.confirmTrip({ confirmed: true });
    setBusy(false);
    if (confirmed.kind !== 'ok') { setFailure(confirmed.kind === 'rejected' ? 'rejected' : confirmed.kind === 'unknown' ? 'unknownWrite' : 'blocked'); return; }
    const tripId = runtime.journey.snapshot().tripId;
    if (tripId) navigate(`/trips/${tripId}/check-in`);
  }
  if (session.state !== 'authenticated') return <section className="tandem-flow"><h1>{t('prepareTitle')}</h1>
    <p>{t('reloadBody')}</p><Link to="/">{t('startOver')}</Link></section>;
  return <section className="tandem-flow"><h1>{t('prepareTitle')}</h1>
    {!catalog && !failure ? <p role="status">{t('loading')}</p> : <form onSubmit={event => void submit(event)}>
      <p>{t('truckLabel')}: {catalog?.trucks[0]?.label ?? t('truckBody')}</p>
      <p>{t('contactsReady')}</p>
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
  return <section className="tandem-flow" data-trip-id={tripId}><h1>{t(title)}</h1>
    {mode === 'summary' ? <p>{t('summaryBody')}</p> : <>
      {check ? <p role="status">{t('checkOpen')} <time dateTime={check.askUntil}>{formattedTimestamp(check.askUntil, locale) ?? check.askUntil}</time></p>
        : <p>{t('noCheck')}</p>}
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
    {mode === 'alerts' && <Deliveries rows={status?.deliveries ?? []} />}
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
