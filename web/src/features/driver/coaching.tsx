import { useEffect, useState } from 'react';
import { Field, PrimaryAction, useMessages } from '../../foundation/index.ts';
import { createIdempotencyKey, type ApiClient, type CoachingNote } from '../../lib/api/index.ts';
import { driverMessages, type DriverMessage } from './messages.ts';

type NoteApi = Pick<ApiClient, 'getCoachingNote' | 'saveCoachingNote' | 'deleteCoachingNote'>;
type Stored = { kind: 'loading' } | { kind: 'off' } | { kind: 'unknown' } | { kind: 'empty' } | { kind: 'saved'; note: CoachingNote };

/** Optional driver note kept in Atomic Memory between trips. It never blocks, reorders or waits on trip controls. */
export function CoachingNotePanel({ api, variant }: { api: NoteApi; variant: 'summary' | 'prepare' }) {
  const t = useMessages(driverMessages);
  const [stored, setStored] = useState<Stored>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DriverMessage | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancel = false;
    api.getCoachingNote().then(read => {
      if (!cancel) setStored(!read.available ? { kind: 'off' } : read.note ? { kind: 'saved', note: read.note } : { kind: 'empty' });
    }, () => { if (!cancel) setStored({ kind: 'unknown' }); });
    return () => { cancel = true; };
  }, [api, attempt]);
  async function run(action: () => Promise<void>, failure: DriverMessage) {
    if (busy) return;
    setBusy(true); setOutcome(null);
    try { await action(); } catch { setOutcome(failure); }
    finally { setBusy(false); }
  }
  const save = () => run(async () => {
    const result = await api.saveCoachingNote({ text: text.trim(), consent: true }, { idempotencyKey: createIdempotencyKey() });
    setStored({ kind: 'saved', note: result.note }); setEditing(false); setConsent(false); setOutcome('noteSaved');
  }, 'noteNotSaved');
  const remove = () => run(async () => {
    await api.deleteCoachingNote({ idempotencyKey: createIdempotencyKey() });
    setStored({ kind: 'empty' }); setEditing(false); setText(''); setOutcome('noteDeleted');
  }, 'noteNotDeleted');
  const status = outcome && <p role={outcome === 'noteSaved' || outcome === 'noteDeleted' ? 'status' : 'alert'} data-note-outcome={outcome}>{t(outcome)}</p>;
  // Trip registration shows only a recalled note; an empty, off or loading memory adds nothing there.
  if (variant === 'prepare' && stored.kind !== 'saved' && stored.kind !== 'unknown' && !outcome) return null;
  if (variant === 'prepare' && stored.kind === 'unknown') return <p className="andes-hint" data-note-state="unknown">{t('noteReadFailed')}</p>;
  const form = <form className="tandem-flow" onSubmit={event => { event.preventDefault(); if (consent && text.trim()) void save(); }}>
    <Field id="coaching-text" label={t('noteLabel')} hint={t('noteHint')} value={text} maxLength={280} autoComplete="off"
      onChange={event => setText(event.target.value)} />
    <label className="tandem-stop"><input data-action="note-consent" type="checkbox" checked={consent}
      onChange={event => setConsent(event.target.checked)} /><span>{t('noteConsent')}</span></label>
    <PrimaryAction data-action="note-save" type="submit" busy={busy} disabled={!consent || !text.trim()}>{t('noteSave')}</PrimaryAction>
    {editing && <PrimaryAction data-action="note-cancel" tone="secondary" onClick={() => { setEditing(false); setConsent(false); }}>{t('noteCancel')}</PrimaryAction>}
  </form>;
  return <section className="tandem-flow" aria-labelledby={`coaching-${variant}`} data-note-state={stored.kind}>
    <h2 id={`coaching-${variant}`}>{t(variant === 'summary' ? 'noteTitle' : 'notePreviousTitle')}</h2>
    {stored.kind === 'loading' && <p role="status">{t('noteLoading')}</p>}
    {stored.kind === 'off' && <p>{t('noteOff')}</p>}
    {stored.kind === 'unknown' && <>
      <p role="alert">{t('noteReadFailed')}</p>
      <PrimaryAction data-action="note-retry" tone="secondary" onClick={() => { setStored({ kind: 'loading' }); setAttempt(n => n + 1); }}>{t('noteRetry')}</PrimaryAction>
    </>}
    {stored.kind === 'empty' && variant === 'summary' && form}
    {stored.kind === 'saved' && (editing ? form : <>
      <blockquote data-note-text>{stored.note.text}</blockquote>
      <p className="andes-hint">{t('noteSource')}</p>
      <PrimaryAction data-action="note-edit" tone="secondary" onClick={() => { setText(stored.note.text); setConsent(false); setEditing(true); setOutcome(null); }}>{t('noteEdit')}</PrimaryAction>
      <PrimaryAction data-action="note-delete" tone="secondary" busy={busy} onClick={() => void remove()}>{t('noteDelete')}</PrimaryAction>
    </>)}
    {status}
  </section>;
}
