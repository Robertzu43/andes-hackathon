import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { I18nProvider, LanguageSwitch, useI18n } from './i18n.tsx';
import { message, type Locale, type MessageKey } from './messages.ts';
import { routeDefinitions, validRouteParams, type RouteId } from './routes.ts';
import { unconfiguredSession, type SessionGateway } from './session.ts';
import { EmptyState, ErrorRecovery, HomeLink, PrimaryAction } from './primitives.tsx';

export interface FeatureRouteProps { params: Readonly<Record<string, string>> }
export type FeatureRoutes = Partial<Record<RouteId, ComponentType<FeatureRouteProps>>>;
export type FoundationOptions = { routes?: FeatureRoutes; session?: SessionGateway; initialLocale?: Locale };
const nothing = () => () => {};
const initialSession = () => unconfiguredSession;
function useSession(gateway?: SessionGateway) {
  return useSyncExternalStore(gateway?.subscribe ?? nothing, gateway?.getSnapshot ?? initialSession, initialSession);
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`andes-brand${compact ? ' andes-brand--compact' : ''}`}>
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M25 12H12v40h13M39 12h13v40H39" /></svg>
    <span>ANDES</span>
  </span>;
}
export function AppShell({ children, session }: { children: ReactNode; session?: SessionGateway }) {
  const { t } = useI18n(); const snapshot = useSession(session); const { pathname } = useLocation();
  return <div className="andes-app"><a className="andes-skip" href="#main-content">{t('skip')}</a>
    <header className="andes-header"><div className="andes-header-top">
      <Link to="/" aria-label="ANDES"><Brand /></Link><LanguageSwitch />
    </div><nav className="andes-nav" aria-label={t('navigation')}>
      <Link to="/" aria-current={pathname === '/' || pathname.startsWith('/trips/') ? 'page' : undefined}>{t('home')}</Link>
      <Link to="/trucks" aria-current={pathname === '/trucks' ? 'page' : undefined}>{t('trucks')}</Link>
      <Link to="/contacts" aria-current={pathname === '/contacts' || pathname.startsWith('/contact/') ? 'page' : undefined}>{t('contacts')}</Link>
    </nav></header>
    {snapshot.mode === 'demo' && <div className="andes-demo" role="status"><strong>{t('demo')}</strong><span>{t('demoNotice')}</span></div>}
    <main id="main-content" className="andes-main" tabIndex={-1}>{children}</main>
    <footer className="andes-footer"><span>{t('footer')}</span><div><Link to="/session">{t('session')}</Link><Link to="/privacy">{t('privacy')}</Link></div></footer>
  </div>;
}
function PageIdentity({ title }: { title: string }) { return <h1>{title}</h1>; }
function RouteFrame({ definition, Component }: { definition: (typeof routeDefinitions)[number]; Component?: ComponentType<FeatureRouteProps> }) {
  const params = useParams(); const { t } = useI18n();
  const location = useLocation();
  const valid = validRouteParams(params);
  const title = valid ? definition.title : 'notFound';
  useEffect(() => {
    document.title = `${t(title)} | ANDES`;
    document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname, title, t]);
  if (!valid) return <NotFound />;
  if (Component) return <Component params={params as Record<string, string>} />;
  return <><PageIdentity title={t(definition.title)} /><EmptyState title={t('unavailableTitle')}
    action={definition.id === 'home' ? <Link className="andes-text-link" to="/session">{t('session')}</Link> : <HomeLink />}>
    <p>{t('unavailableBody')}</p>
  </EmptyState></>;
}
export function SessionAccess({ gateway }: { gateway?: SessionGateway }) {
  const { t } = useI18n(); const snapshot = useSession(gateway);
  const [failed, setFailed] = useState(false); const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const connected = snapshot.state === 'authenticated';
  const action = async () => {
    if (inFlight.current || !gateway?.begin) return;
    inFlight.current = true; setBusy(true); setFailed(false);
    try { await gateway.begin(); } catch { setFailed(true); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const description: MessageKey = connected ? 'authenticated' : snapshot.state === 'expired' ? 'expired'
    : snapshot.state === 'unconfigured' ? 'disconnected' : 'signedOut';
  return <><PageIdentity title={t('session')} /><section aria-labelledby="access-title" className="andes-section">
    <h2 id="access-title">{t('access')}</h2><p className="andes-prose">{t(description)}</p>
    {(failed || snapshot.state === 'error') && <ErrorRecovery title={t('accessError')} />}
    {snapshot.state === 'unconfigured' && <p className="andes-hint" id="access-limit">{t('accessRecovery')}</p>}
    {connected ? <PrimaryAction tone="secondary" onClick={() => gateway?.end?.()} disabled={!gateway?.end}>{t('signOut')}</PrimaryAction>
      : <PrimaryAction data-action="session-primary" onClick={() => void action()} busy={busy || snapshot.state === 'connecting'} busyLabel={t('connecting')}
        disabled={!gateway?.begin || snapshot.state === 'unconfigured'} aria-describedby={snapshot.state === 'unconfigured' ? 'access-limit' : undefined}>{t('continue')}</PrimaryAction>}
  </section><section aria-labelledby="test-mode-title" className="andes-section andes-secondary-section">
    <h2 id="test-mode-title">{t('testMode')}</h2><p className="andes-prose">{t(snapshot.mode === 'demo' ? 'demoAvailable' : 'demoUnavailable')}</p>
  </section></>;
}
function NotFound() {
  const { t } = useI18n();
  useEffect(() => { document.title = `${t('notFound')} | ANDES`; }, [t]);
  return <><PageIdentity title={t('notFound')} /><p className="andes-prose">{t('notFoundBody')}</p><HomeLink /></>;
}
export function FoundationApp({ routes = {}, session }: FoundationOptions) {
  return <AppShell session={session}><Routes>{routeDefinitions.map(definition => <Route key={definition.id} path={definition.path}
    element={definition.id === 'session' ? <SessionRoute session={session} /> : <RouteFrame definition={definition} Component={routes[definition.id]} />} />)}
    <Route path="*" element={<NotFound />} /></Routes></AppShell>;
}
function SessionRoute({ session }: { session?: SessionGateway }) {
  const { locale } = useI18n(); const location = useLocation();
  useEffect(() => {
    document.title = `${message(locale, 'session')} | ANDES`;
    document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [locale, location.pathname]);
  return <SessionAccess gateway={session} />;
}
export function FoundationRoot(options: FoundationOptions = {}) {
  return <I18nProvider initialLocale={options.initialLocale}><BrowserRouter><FoundationApp {...options} /></BrowserRouter></I18nProvider>;
}
