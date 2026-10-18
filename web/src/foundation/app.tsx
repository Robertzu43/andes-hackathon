import { Component, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useMatch, useParams } from 'react-router';
import { I18nProvider, LanguageSwitch, useI18n } from './i18n.tsx';
import { message, type Locale, type MessageKey } from './messages.ts';
import { routeDefinitions, validRouteParams, type RouteId } from './routes.ts';
import { unconfiguredSession, type SessionGateway } from './session.ts';
import { EmptyState, ErrorRecovery, HomeLink, PrimaryAction } from './primitives.tsx';

export interface FeatureRouteProps { params: Readonly<Record<string, string>> }
export type FeatureRoutes = Partial<Record<RouteId, ComponentType<FeatureRouteProps>>>;
export type FoundationOptions = { routes?: FeatureRoutes; session?: SessionGateway; initialLocale?: Locale };
const initialSession = () => unconfiguredSession;
function useSession(gateway?: SessionGateway) {
  const subscribe = useCallback((listener: () => void) => gateway ? gateway.subscribe(listener) : () => {}, [gateway]);
  const getSnapshot = useCallback(() => gateway ? gateway.getSnapshot() : unconfiguredSession, [gateway]);
  return useSyncExternalStore(subscribe, getSnapshot, initialSession);
}
class RenderBoundary extends Component<{ children: ReactNode; fallback: (retry: () => void) => ReactNode; resetKey?: unknown }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() { return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children; }
}
function SessionBanner({ session }: { session?: SessionGateway }) {
  const { t } = useI18n(); const snapshot = useSession(session);
  return snapshot.mode === 'demo' ? <div className="andes-demo" role="status"><strong>{t('demo')}</strong><span>{t('demoNotice')}</span></div> : null;
}
function NavigationFocus() {
  const { pathname } = useLocation(); const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const main = document.querySelector<HTMLElement>('#main-content');
    if (!main || (document.activeElement !== main && main.contains(document.activeElement))) return;
    main.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}
// Tándem T-mark and outlined Manrope wordmark: docs/design/assets/tandem-logo-ink.svg, rounded to 0.1 units.
const logoPaths = [
  'M12 8H44V88H28V28H8V12Q8 8 12 8Z',
  'M52 8H84Q88 8 88 12V28H68V88H52Z',
  'M135.5 78V34.3H118.7V26.2H161V34.3H144.2V78Z',
  'M185.3 33.5H178.7L184.2 20.2H190.8ZM176.5 79.1Q172.3 79.1 169.3 77.5Q166.4 75.9 164.9 73.2Q163.4 70.5 163.4 67.3Q163.4 64.5 164.4 62.3Q165.3 60.1 167.3 58.4Q169.2 56.8 172.3 55.7Q174.7 54.9 177.8 54.3Q180.9 53.7 184.6 53.2Q188.3 52.7 192.4 52.1L189.2 53.8Q189.3 49.8 187.5 47.9Q185.6 46 181.3 46Q178.6 46 176.2 47.2Q173.7 48.4 172.8 51.4L164.8 48.9Q166.3 44 170.3 41Q174.4 38 181.3 38Q186.5 38 190.4 39.7Q194.3 41.4 196.3 45.3Q197.3 47.3 197.5 49.5Q197.7 51.6 197.7 54.1V78H190.1V69.6L191.4 71Q188.8 75.1 185.2 77.1Q181.7 79.1 176.5 79.1ZM178.2 72.2Q181.2 72.2 183.2 71.1Q185.3 70.1 186.6 68.6Q187.8 67.1 188.2 65.7Q188.9 64.1 189 61.9Q189.1 59.8 189.1 58.4L191.8 59.2Q187.8 59.9 185 60.3Q182.2 60.8 180.2 61.2Q178.2 61.6 176.7 62.1Q175.2 62.7 174.1 63.4Q173.1 64.1 172.5 65Q172 66 172 67.2Q172 68.7 172.7 69.8Q173.4 70.9 174.8 71.5Q176.2 72.2 178.2 72.2Z',
  'M232.9 78V59.3Q232.9 57.5 232.6 55.2Q232.4 53 231.4 50.9Q230.5 48.9 228.7 47.5Q226.9 46.2 223.8 46.2Q222.1 46.2 220.5 46.7Q218.9 47.3 217.6 48.6Q216.3 49.9 215.5 52.2Q214.7 54.5 214.7 58L209.6 55.8Q209.6 50.9 211.5 46.8Q213.4 42.8 217.1 40.4Q220.9 38 226.4 38Q230.7 38 233.5 39.4Q236.3 40.9 237.9 43.1Q239.6 45.4 240.4 47.9Q241.2 50.4 241.4 52.7Q241.7 54.9 241.7 56.3V78ZM205.9 78V39.1H213.6V51.2H214.7V78Z',
  'M265.5 79.1Q260.1 79.1 256.1 76.4Q252.2 73.7 250 69Q247.8 64.4 247.8 58.5Q247.8 52.6 250 48Q252.2 43.4 256.3 40.7Q260.3 38 265.8 38Q271.4 38 275.1 40.7Q278.9 43.4 280.8 48.1Q282.8 52.7 282.8 58.5Q282.8 64.4 280.8 69Q278.9 73.7 275 76.4Q271.2 79.1 265.5 79.1ZM266.8 71.3Q270.3 71.3 272.5 69.7Q274.6 68.1 275.6 65.2Q276.6 62.3 276.6 58.5Q276.6 54.8 275.6 51.9Q274.6 49 272.5 47.4Q270.4 45.8 267.1 45.8Q263.6 45.8 261.4 47.5Q259.1 49.2 258 52.1Q256.9 55 256.9 58.5Q256.9 62.1 258 65Q259.1 67.9 261.3 69.6Q263.4 71.3 266.8 71.3ZM276.6 78V50.7H275.5V26.2H284.2V78Z',
  'M310.9 79.1Q305 79.1 300.5 76.5Q296.1 74 293.6 69.4Q291.1 64.9 291.1 59Q291.1 52.6 293.5 47.9Q296 43.2 300.3 40.6Q304.7 38 310.4 38Q316.5 38 320.7 40.9Q324.9 43.7 327 48.8Q329 54 328.5 61H319.9V57.8Q319.9 51.5 317.7 48.5Q315.5 45.6 310.8 45.6Q305.5 45.6 302.9 48.9Q300.3 52.2 300.3 58.6Q300.3 64.5 302.9 67.7Q305.5 71 310.4 71Q313.6 71 315.9 69.5Q318.3 68.1 319.5 65.4L328.1 68Q325.9 73.3 321.2 76.2Q316.5 79.1 310.9 79.1ZM297.5 61V54.4H324.3V61Z',
  'M382.2 78 382.2 54.4Q382.2 50.4 380.2 48.1Q378.2 45.9 374.8 45.9Q372.7 45.9 371.1 46.8Q369.4 47.8 368.5 49.7Q367.5 51.5 367.5 54.1L363.6 51.8Q363.6 47.7 365.5 44.7Q367.3 41.6 370.5 39.9Q373.6 38.2 377.5 38.2Q384 38.2 387.4 42Q390.9 45.9 390.9 52.2L390.8 78ZM335.4 78V39.1H343.1V51.2H344.1V78ZM358.8 78 358.8 54.5Q358.8 50.4 356.9 48.2Q354.9 45.9 351.5 45.9Q348.2 45.9 346.2 48.1Q344.1 50.4 344.1 54.1L340.3 51.5Q340.3 47.7 342.2 44.7Q344 41.7 347.2 39.9Q350.4 38.2 354.4 38.2Q358.7 38.2 361.6 40Q364.6 41.9 366 45Q367.5 48.2 367.5 52.2L367.5 78Z',
];
export function Brand() {
  return <svg className="andes-brand" viewBox="0 0 402 104" aria-hidden="true" focusable="false">
    {logoPaths.map(d => <path key={d} d={d} />)}
  </svg>;
}
export function AppShell({ children, session }: { children: ReactNode; session?: SessionGateway }) {
  const { t } = useI18n();
  const home = useMatch('/'); const trip = useMatch('/trips/*'); const trucks = useMatch('/trucks/*');
  const contacts = useMatch('/contacts/*'); const contact = useMatch('/contact/*');
  return <div className="andes-app"><a className="andes-skip" href="#main-content">{t('skip')}</a>
    <header className="andes-header"><div className="andes-header-top">
      <Link to="/" aria-label="Tándem"><Brand /></Link><LanguageSwitch />
    </div><nav className="andes-nav" aria-label={t('navigation')}>
      <Link to="/" aria-current={home || trip ? 'page' : undefined}>{t('home')}</Link>
      <Link to="/trucks" aria-current={trucks ? 'page' : undefined}>{t('trucks')}</Link>
      <Link to="/contacts" aria-current={contacts || contact ? 'page' : undefined}>{t('contacts')}</Link>
    </nav></header>
    <RenderBoundary resetKey={session} fallback={() => <div className="andes-demo" role="alert">{t('accessError')}</div>}><SessionBanner session={session} /></RenderBoundary>
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
    document.title = `${t(title)} | Tándem`;
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
  useEffect(() => { if (connected) setFailed(false); }, [connected]);
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
    {!connected && (failed || snapshot.state === 'error') && <ErrorRecovery title={t('accessError')} />}
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
  useEffect(() => { document.title = `${t('notFound')} | Tándem`; }, [t]);
  return <><PageIdentity title={t('notFound')} /><p className="andes-prose">{t('notFoundBody')}</p><HomeLink /></>;
}
function RouteRecovery({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  useEffect(() => { document.title = `${t('viewError')} | Tándem`; }, [t]);
  return <section data-route-recovery><PageIdentity title={t('viewError')} /><p>{t('viewRecovery')}</p>
    <div className="andes-actions"><PrimaryAction onClick={onRetry}>{t('retry')}</PrimaryAction><HomeLink /></div></section>;
}
export function FoundationApp({ routes = {}, session }: FoundationOptions) {
  const { pathname } = useLocation();
  return <AppShell session={session}><NavigationFocus />
    <RenderBoundary key={pathname} fallback={retry => <RouteRecovery onRetry={retry} />}>
    <Routes>{routeDefinitions.map(definition => <Route key={definition.id} path={definition.path}
      element={definition.id === 'session' ? <SessionRoute session={session} /> : <RouteFrame definition={definition} Component={routes[definition.id]} />} />)}
      <Route path="*" element={<NotFound />} /></Routes></RenderBoundary></AppShell>;
}
function SessionRoute({ session }: { session?: SessionGateway }) {
  const { locale } = useI18n(); const location = useLocation();
  useEffect(() => {
    document.title = `${message(locale, 'session')} | Tándem`;
  }, [locale, location.pathname]);
  return <SessionAccess gateway={session} />;
}
export function FoundationRoot(options: FoundationOptions = {}) {
  return <I18nProvider initialLocale={options.initialLocale}><BrowserRouter><FoundationApp {...options} /></BrowserRouter></I18nProvider>;
}
