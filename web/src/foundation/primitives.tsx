import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from './i18n.tsx';

export function PrimaryAction({ children, busy = false, busyLabel, tone = 'primary', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: string; tone?: 'primary' | 'secondary' | 'danger' }) {
  return <button {...props} className={`andes-button andes-button--${tone}`} type={props.type ?? 'button'}
    aria-busy={busy || undefined} aria-disabled={busy || props.disabled || undefined} disabled={props.disabled}
    onClick={event => { if (busy || props.disabled) { event.preventDefault(); return; } props.onClick?.(event); }}>
    {busy && busyLabel ? busyLabel : children}</button>;
}
export function ActionGroup({ children }: { children: ReactNode }) { return <div className="andes-actions">{children}</div>; }
export function TripIdentity({ label, route }: { label: string; route?: string }) {
  return <div className="andes-trip-identity"><strong>{label}</strong>{route && <p>{route}</p>}</div>;
}
export function FactRow({ label, children, source, timestamp, ageLabel }:
  { label: string; children: ReactNode; source?: string; timestamp?: string; ageLabel?: string }) {
  const { t, locale } = useI18n();
  const valid = timestamp !== undefined && Number.isFinite(Date.parse(timestamp));
  return <div className="andes-fact-row"><dt>{label}</dt><dd><div>{children}</div>
    {(source || timestamp || ageLabel) && <p className="andes-source">
      {source && <span>{t('source')}: {source}</span>}
      {timestamp && <span>{t('observedAt')}: {valid
        ? <time dateTime={timestamp}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(timestamp))} UTC</time>
        : t('unknown')}</span>}
      {ageLabel && <span>{ageLabel}</span>}
    </p>}
  </dd></div>;
}
export function AttributedUpdate({ source, children, timestamp }:
  { source: string; children: ReactNode; timestamp?: string }) {
  return <div className="andes-update"><strong>{source}</strong><div>{children}</div>
    {timestamp && <p className="andes-source"><time dateTime={timestamp}>{timestamp}</time></p>}
  </div>;
}
export function Field({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> &
  { label: string; hint?: string; error?: string }) {
  const generated = useId(); const id = props.id ?? generated;
  return <div className="andes-field"><label htmlFor={id}>{label}</label>
    {hint && <p id={`${id}-hint`} className="andes-hint">{hint}</p>}
    <input {...props} id={id} aria-invalid={!!error || undefined}
      aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : '', props['aria-describedby'] ?? ''].filter(Boolean).join(' ') || undefined} />
    {error && <p id={`${id}-error`} className="andes-field-error">{error}</p>}
  </div>;
}
export function SelectField({ label, hint, error, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> &
  { label: string; hint?: string; error?: string }) {
  const generated = useId(); const id = props.id ?? generated;
  return <div className="andes-field"><label htmlFor={id}>{label}</label>
    {hint && <p id={`${id}-hint`} className="andes-hint">{hint}</p>}
    <select {...props} id={id} aria-invalid={!!error || undefined}
      aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : '', props['aria-describedby'] ?? ''].filter(Boolean).join(' ') || undefined}>{children}</select>
    {error && <p id={`${id}-error`} className="andes-field-error">{error}</p>}
  </div>;
}
export function ConsentScope({ legend, options, disabled = false }:
  { legend: string; disabled?: boolean; options: readonly { id: string; label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }[] }) {
  return <fieldset className="andes-consent" disabled={disabled}><legend>{legend}</legend>
    {options.map(option => <label key={option.id} className="andes-choice">
      <input type="checkbox" checked={option.checked} onChange={e => option.onChange(e.target.checked)} />
      <span><strong>{option.label}</strong>{option.description && <span>{option.description}</span>}</span>
    </label>)}
  </fieldset>;
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="andes-empty"><h2>{title}</h2>{children && <div className="andes-prose">{children}</div>}{action}</div>;
}
export function ErrorRecovery({ title, children, onRetry, retryLabel }:
  { title: string; children?: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  const { t } = useI18n();
  return <div className="andes-feedback andes-feedback--error" role="alert"><h2>{title}</h2>{children}
    {onRetry && <PrimaryAction tone="secondary" onClick={onRetry}>{retryLabel ?? t('retry')}</PrimaryAction>}
  </div>;
}
export function PermissionState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="andes-feedback" role="status"><h2>{title}</h2>{children}</div>;
}
export function AsyncState({ state, children, emptyTitle, errorTitle, onRetry }:
  { state: 'loading' | 'empty' | 'error' | 'ready'; children?: ReactNode; emptyTitle?: string; errorTitle?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  if (state === 'loading') return <div className="andes-loading" role="status"><p>{t('loading')}</p><div className="andes-skeleton" aria-hidden="true" /></div>;
  if (state === 'empty') return <EmptyState title={emptyTitle ?? t('unknown')} />;
  if (state === 'error') return <ErrorRecovery title={errorTitle ?? t('error')} onRetry={onRetry} />;
  return <>{children}</>;
}
export function HomeLink() {
  const { t } = useI18n();
  return <Link className="andes-text-link" to="/">{t('backHome')}</Link>;
}
