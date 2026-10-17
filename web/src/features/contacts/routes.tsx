import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ActionGroup, AsyncState, AttributedUpdate, ConsentScope, EmptyState, ErrorRecovery,
  FactRow, Field, PermissionState, PrimaryAction, TripIdentity, useMessages,
  type FeatureRoutes } from '../../foundation/index.ts';
import type { ContactSummary } from '../../lib/api/index.ts';
import { PrivacyContent } from '../privacy/page.tsx';
import { contactMessages, type ContactMessage } from './messages.ts';
import { createContactView, type ContactHost, type ContactView } from './view-store.ts';
import './ui.css';

type Snapshot = ReturnType<ContactView['getSnapshot']>;
type Translate = (key: ContactMessage) => string;
function useView(host: ContactHost, view: 'driver' | 'contact', tripId?: string) {
  const store = useMemo(() => createContactView(host, view, tripId), [host, view, tripId]);
  useEffect(() => { store.start(); return () => store.stop(); }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, snapshot };
}
function Gate({ store, snapshot, children }: { store: ContactView; snapshot: Snapshot; children: ReactNode }) {
  const t = useMessages(contactMessages);
  if (snapshot.status === 'verifying') return <AsyncState state="loading" />;
  if (snapshot.status === 'error') return <ErrorRecovery title={t('verificationError')} retryLabel={t('refresh')} onRetry={store.restart}>
    <p>{t(snapshot.failure ?? 'unavailable')}</p></ErrorRecovery>;
  if (snapshot.status !== 'ready') return <PermissionState title={t('sessionTitle')}>
    <p>{t('sessionBody')}</p><Link className="andes-text-link" to="/session">{t('sessionLink')}</Link></PermissionState>;
  return <>{children}</>;
}
function OperationFeedback({ store, snapshot }: { store: ContactView; snapshot: Snapshot }) {
  const t = useMessages(contactMessages); const op = snapshot.journey.operation;
  if (op.status === 'pending') return <div className="andes-feedback" role="status"><p>{t('pendingWrite')}</p></div>;
  if (op.status === 'uncertain') return <div className="andes-feedback" role="status" data-contact-state="uncertain">
    <h2>{t('unknownWrite')}</h2><p>{t('unknownHint')}</p>
    <PrimaryAction tone="secondary" data-action="retry-same" onClick={() => { void store.retry().then(() => {
      requestAnimationFrame(() => { if (store.getSnapshot().status !== 'ready') return;
        document.querySelector<HTMLElement>('[data-action="retry-same"], [data-contact-state="recorded"]')?.focus(); });
    }); }}>{t('retrySame')}</PrimaryAction></div>;
  if (op.status === 'rejected' || snapshot.failure) {
    const reason = snapshot.failure ?? op.failure;
    const key = reason && reason in contactMessages.es ? reason as ContactMessage : 'unavailable';
    return <ErrorRecovery title={t('rejected')}><p>{t(key)}</p></ErrorRecovery>;
  }
  if (op.status !== 'recorded') return null;
  const key = op.kind === 'invite' ? 'invitationRecorded' : op.kind.startsWith('revoke') ? 'revokeRecorded'
    : op.kind === 'acknowledge' ? 'ackRecorded' : op.kind === 'report-action' ? 'actionRecorded' : 'recorded';
  return <div className="andes-feedback" role="status" tabIndex={-1} data-contact-state="recorded"><p>{t(key)}</p></div>;
}
function Revoke({ title, hint, onConfirm, busy, disabled = false }: { title: string; hint: string; onConfirm: () => Promise<unknown>; busy: boolean; disabled?: boolean }) {
  const t = useMessages(contactMessages); const [confirm, setConfirm] = useState(false);
  if (!confirm) return <PrimaryAction tone="secondary" onClick={() => setConfirm(true)} busy={busy} disabled={disabled}>{title}</PrimaryAction>;
  return <div className="andes-contact-revoke"><p><strong>{title}</strong></p><p className="andes-hint">{hint}</p>
    <ActionGroup><PrimaryAction tone="danger" busy={busy} disabled={disabled} onClick={() => { void onConfirm().then(() => setConfirm(false)); }}>{t('confirmRevoke')}</PrimaryAction>
      <PrimaryAction tone="secondary" onClick={() => setConfirm(false)} disabled={busy}>{t('cancel')}</PrimaryAction></ActionGroup></div>;
}
function scopeNames(row: ContactSummary, field: 'requested' | 'accepted', t: Translate) {
  return [row.map[field] ? t('map') : '', row.incident[field] ? t('incident') : ''].filter(Boolean).join(' · ') || t('none');
}
function Catalog({ store, snapshot }: { store: ContactView; snapshot: Snapshot }) {
  const t = useMessages(contactMessages); const catalog = snapshot.catalog;
  const revokeBlocked = snapshot.journey.operation.kind.startsWith('revoke') && ['pending', 'uncertain'].includes(snapshot.journey.operation.status);
  if (catalog.status === 'loading') return <AsyncState state="loading" />;
  if (catalog.status === 'error') return <ErrorRecovery title={t('catalogError')} onRetry={() => void store.loadContacts()} retryLabel={t('refresh')}>
    <p>{t(catalog.failure ?? 'unavailable')}</p></ErrorRecovery>;
  if (!catalog.data) return <p className="andes-prose">{t('reloadContacts')}</p>;
  if (catalog.data.contacts.length === 0) return <EmptyState title={t('emptyContacts')}><p>{t('emptyContactsBody')}</p></EmptyState>;
  return <>{catalog.data.hasMore && <p className="andes-hint" role="status">{t('truncated')}</p>}
    <ul className="andes-contact-list">{catalog.data.contacts.map(row => <li key={row.id}>
      <div className="andes-contact-heading"><h3>{row.phone}</h3><span>{t(row.status)}</span></div>
      <dl className="andes-fact-list"><FactRow label={t('requested')}>{scopeNames(row, 'requested', t)}</FactRow>
        <FactRow label={t('acceptedScopes')}>{scopeNames(row, 'accepted', t)}</FactRow>
        {row.acceptedAt && <FactRow label={t('acceptedAt')} timestamp={row.acceptedAt} source={t('sourceServer')}>{t('accepted')}</FactRow>}
        {row.revokedAt && <FactRow label={t('revokedAt')} timestamp={row.revokedAt} source={t('sourceServer')}>{t('revoked')}</FactRow>}
      </dl>
      {row.status !== 'revoked' && <Revoke title={t('revoke')} hint={t('revokeHint')}
        busy={snapshot.journey.operation.status === 'pending'} onConfirm={() => store.revokeStanding(row.id)} />}
    </li>)}</ul><p className="andes-hint">{t('historical')}</p>
    {revokeBlocked && <p className="andes-hint">{t('unknownHint')}</p>}</>;
}
function InviteForm({ store, snapshot, onClose }: { store: ContactView; snapshot: Snapshot; onClose: () => void }) {
  const t = useMessages(contactMessages);
  const [contactId, setId] = useState(''); const [phone, setPhone] = useState('');
  const [map, setMap] = useState(false); const [incident, setIncident] = useState(false); const [submitted, setSubmitted] = useState(false);
  const locked = ['pending', 'uncertain'].includes(snapshot.journey.operation.status);
  const validId = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(contactId)
    && contactId.toLowerCase() !== snapshot.journey.session?.actorId;
  const validPhone = /^\+[1-9]\d{6,14}$/.test(phone);
  useEffect(() => { document.getElementById('invite-contact-id')?.focus(); }, []);
  return <form className="andes-section" noValidate onSubmit={event => {
    event.preventDefault(); if (locked) return; setSubmitted(true);
    if (!validId || !validPhone || !map && !incident) return;
    void store.invite({ contactId, phone, map, incident }).then(() => {
      if (store.getSnapshot().journey.operation.status === 'recorded') onClose();
    });
  }}><h2>{t('invite')}</h2><p className="andes-hint">{t('inviteHint')}</p>
    <Field id="invite-contact-id" label={t('contactId')} hint={t('contactIdHint')} autoComplete="off" value={contactId}
      disabled={locked} onChange={e => setId(e.target.value)} error={submitted && !validId ? t('invalidId') : undefined} />
    <Field label={t('phone')} hint={t('phoneHint')} type="tel" autoComplete="off" value={phone} disabled={locked}
      onChange={e => setPhone(e.target.value)} error={submitted && !validPhone ? t('invalidPhone') : undefined} />
    <ConsentScope legend={t('chooseScopes')} disabled={locked} options={[
      { id: 'map', label: t('map'), description: t('mapHint'), checked: map, onChange: setMap },
      { id: 'incident', label: t('incident'), description: t('incidentHint'), checked: incident, onChange: setIncident },
    ]} />{submitted && !map && !incident && <p role="alert" className="andes-field-error">{t('invalidScope')}</p>}
    <ActionGroup><PrimaryAction type="submit" busy={snapshot.journey.operation.status === 'pending'} disabled={snapshot.journey.operation.status === 'uncertain'}>{t('invite')}</PrimaryAction>
      <PrimaryAction tone="secondary" onClick={onClose} disabled={locked}>{t('close')}</PrimaryAction></ActionGroup></form>;
}
function Management({ host, privacy = false }: { host: ContactHost; privacy?: boolean }) {
  const t = useMessages(contactMessages); const { store, snapshot } = useView(host, 'driver'); const [showForm, setForm] = useState(false);
  const revokeBlocked = snapshot.journey.operation.kind.startsWith('revoke') && ['pending', 'uncertain'].includes(snapshot.journey.operation.status);
  const catalog = <><OperationFeedback store={store} snapshot={snapshot} /><section className="andes-section" aria-labelledby="contact-list-title">
    <h2 id="contact-list-title">{t('contacts')}</h2>
    <ActionGroup>{!privacy && <PrimaryAction data-action="invite-open" disabled={['pending', 'uncertain'].includes(snapshot.journey.operation.status)}
      onClick={() => setForm(true)}>{t('invite')}</PrimaryAction>}
      <PrimaryAction tone="secondary" busy={snapshot.catalog.status === 'loading'} disabled={revokeBlocked}
        onClick={() => void store.loadContacts()}>{t(privacy ? 'review' : 'refresh')}</PrimaryAction></ActionGroup>
    <Catalog store={store} snapshot={snapshot} /></section>
    {showForm && !privacy && <InviteForm store={store} snapshot={snapshot} onClose={() => { setForm(false);
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-action="invite-open"]')?.focus()); }} />}</>;
  return <><h1>{t(privacy ? 'privacyTitle' : 'contactsTitle')}</h1><Gate store={store} snapshot={snapshot}>
    {privacy ? <PrivacyContent>{catalog}</PrivacyContent> : catalog}</Gate></>;
}
function InvitationPage({ host, grantId }: { host: ContactHost; grantId: string }) {
  const t = useMessages(contactMessages); const { store, snapshot } = useView(host, 'contact');
  return <><h1>{t('invitationTitle')}</h1><Gate store={store} snapshot={snapshot}>
    <OperationFeedback store={store} snapshot={snapshot} />
    <section className="andes-section"><EmptyState title={t('invitationUnknown')}><p>{t('invitationUnknownBody')}</p></EmptyState>
      <PrimaryAction disabled aria-describedby="accept-limit">{t('review')}</PrimaryAction><p id="accept-limit" className="andes-hint">{t('unavailableAccept')}</p></section>
    <section className="andes-section andes-secondary-section"><h2>{t('permissions')}</h2><p>{t('withdrawHint')}</p>
      <Revoke title={t('withdraw')} hint={t('revokeHint')} busy={snapshot.journey.operation.status === 'pending'}
        disabled={snapshot.journey.operation.status === 'uncertain'} onConfirm={() => store.revokeStanding(grantId)} />
    </section></Gate></>;
}
function Location({ store, snapshot }: { store: ContactView; snapshot: Snapshot }) {
  const t = useMessages(contactMessages); const location = snapshot.journey.location; const fact = location.data;
  const blocked = snapshot.journey.operation.kind.startsWith('revoke') && ['pending', 'uncertain'].includes(snapshot.journey.operation.status);
  return <section className="andes-section" aria-labelledby="location-title"><h2 id="location-title">{t('location')}</h2>
    {location.status === 'loading' ? <AsyncState state="loading" /> : fact?.location ? <>
      <dl className="andes-fact-list"><FactRow label={t('location')} source={t('sourcePhone')} timestamp={fact.location.capturedAt}>
        {t(fact.freshness === 'fresh' ? 'fresh' : 'stale')}</FactRow>
        <FactRow label={t('coordinates')}>{fact.location.latitude.toFixed(5)}, {fact.location.longitude.toFixed(5)}</FactRow>
        <FactRow label={t('accuracy')}>{fact.location.accuracy} m</FactRow>
        <FactRow label={t('age')}>{fact.ageMs === null ? t('unknown') : `${Math.floor(fact.ageMs / 60_000)} ${t('minutes')}`}</FactRow>
        <FactRow label={t('received')} timestamp={fact.location.receivedAt} source={t('sourceServer')}>{t('observationReceived')}</FactRow>
        <FactRow label={t('read')} timestamp={fact.readAt} source={t('sourceServer')}>{t('locationRead')}</FactRow></dl><p className="andes-hint">{t('locationLimit')}</p></>
      : <EmptyState title={t(location.status === 'denied' ? 'locationDenied' : 'locationUnavailable')}><p>{t('locationUnknown')}</p></EmptyState>}
    <ActionGroup><PrimaryAction tone="secondary" busy={location.status === 'loading'} disabled={blocked} onClick={() => void store.loadLocation()}>{t('refresh')}</PrimaryAction></ActionGroup>
  </section>;
}
function ResponseForm({ store, snapshot }: { store: ContactView; snapshot: Snapshot }) {
  const t = useMessages(contactMessages);
  const [action, setAction] = useState(''); const [invalid, setInvalid] = useState(false);
  const active = snapshot.journey.incident.data?.status === 'active';
  const locked = ['pending', 'uncertain'].includes(snapshot.journey.operation.status);
  return <section className="andes-section andes-secondary-section" aria-labelledby="response-title"><h2 id="response-title">{t('response')}</h2>
    <ActionGroup><PrimaryAction data-action="response-open" disabled={!active || locked} onClick={() => {
      const input = document.querySelector<HTMLInputElement>('.andes-contact-report input'); input?.focus(); input?.scrollIntoView({ block: 'center' });
    }}>{t('writeResponse')}</PrimaryAction>
      <PrimaryAction tone="secondary" data-action="acknowledge" disabled={!active || locked} onClick={() => void store.acknowledge()}>{t('acknowledge')}</PrimaryAction></ActionGroup>
    <p className="andes-hint andes-contact-resolution">{t('ownerResolution')}</p>
    <form className="andes-contact-report" noValidate onSubmit={event => { event.preventDefault(); if (!active || locked) return;
      const valid = !!action.trim() && [...action].length <= 300; setInvalid(!valid); if (valid) void store.reportAction(action); }}>
      <Field label={t('actionLabel')} hint={t('actionHint')} value={action} disabled={!active || locked} maxLength={600}
        onChange={e => setAction(e.target.value)} error={invalid ? t('actionInvalid') : undefined} />
      <PrimaryAction type="submit" data-action="report" disabled={!active || snapshot.journey.operation.status === 'uncertain'} busy={snapshot.journey.operation.status === 'pending'}>{t('report')}</PrimaryAction>
    </form>
    {snapshot.journey.receipts.length > 0 && <div className="andes-contact-receipts"><p className="andes-hint">{t('ownReceipts')}</p>
      {snapshot.journey.receipts.map((receipt, index) => <AttributedUpdate key={index} source={t('yourReport')}>
        <p>{receipt.recorded === 'acknowledged' ? t('yourAcknowledgement') : receipt.action}</p></AttributedUpdate>)}</div>}
  </section>;
}
function TripPage({ host, tripId }: { host: ContactHost; tripId: string }) {
  const t = useMessages(contactMessages); const { store, snapshot } = useView(host, 'contact', tripId);
  const incident = snapshot.journey.incident;
  const locked = ['pending', 'uncertain'].includes(snapshot.journey.operation.status);
  const knownIncident = !!host.incidentReference?.(tripId); const knownGrant = !!host.grantReference?.(tripId);
  return <><h1>{t('tripTitle')}</h1><Gate store={store} snapshot={snapshot}>
    <OperationFeedback store={store} snapshot={snapshot} />
    <div className="andes-contact-layout"><div><section className="andes-section" aria-labelledby="incident-title">
      <h2 id="incident-title">{t('incidentTitle')}</h2>
      {incident.status === 'loading' ? <AsyncState state="loading" /> : incident.data ? <>
        <TripIdentity label={t(incident.data.status === 'active' ? 'active' : 'resolved')} />
      </> : <EmptyState title={t(incident.status === 'denied' ? 'incidentDenied' : 'incidentUnknown')}><p>{t('incidentUnknownBody')}</p></EmptyState>}
      {knownIncident && <PrimaryAction tone="secondary" busy={incident.status === 'loading'} disabled={locked} onClick={() => void store.loadIncident()}>{t('refresh')}</PrimaryAction>}
    </section><ResponseForm key={snapshot.journey.session?.actorId ?? 'none'} store={store} snapshot={snapshot} /></div><aside><Location store={store} snapshot={snapshot} />
      <section className="andes-section andes-secondary-section"><h2>{t('facts')}</h2><dl className="andes-fact-list">
        {incident.data && <FactRow label={t('incidentCreated')} timestamp={incident.data.createdAt} source={t('sourceServer')}>{t('incidentTitle')}</FactRow>}
        {incident.data?.resolvedAt && <FactRow label={t('incidentResolved')} timestamp={incident.data.resolvedAt} source={t('sourceServer')}>{t('resolved')}</FactRow>}
        <FactRow label={t('lastResponse')}>{t('unknown')}</FactRow><FactRow label={t('deadline')}>{t('unknown')}</FactRow><FactRow label={t('delivery')}>{t('unknown')}</FactRow>
      </dl></section></aside></div>
    <section className="andes-section andes-secondary-section"><h2>{t('permissions')}</h2>
      {knownGrant ? <Revoke title={t('revokeTrip')} hint={t('revokeTripHint')} busy={snapshot.journey.operation.status === 'pending'}
        disabled={snapshot.journey.operation.status === 'uncertain' && snapshot.journey.operation.kind.startsWith('revoke')} onConfirm={store.revokeTrip} />
        : <p>{t('unavailableGrant')}</p>}
    </section></Gate></>;
}

/** Inject these four components into49's existing registry. One shared API/session/gateway per host. */
export function createContactRoutes(host: ContactHost): FeatureRoutes {
  return {
    contacts: () => <Management host={host} />,
    privacy: () => <Management host={host} privacy />,
    invitation: ({ params }) => <InvitationPage key={params.grantId} host={host} grantId={params.grantId!} />,
    contactTrip: ({ params }) => <TripPage key={params.tripId} host={host} tripId={params.tripId!} />,
  };
}
