import { createElement, useCallback, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { PrimaryAction, useMessages, type FeatureRouteProps, type FeatureRoutes } from '../foundation/index.ts';
import { createContactRoutes } from '../features/contacts/routes.tsx';
import { driverMessages } from '../features/driver/messages.ts';
import { Alerts, CheckIn, Home, Prepare, Summary, TripHome, Trucks } from '../features/driver/screens.tsx';
import type { PhoneDemoRuntime } from './runtime.ts';

function useFamily(gateway: PhoneDemoRuntime['familyGateway']) {
  const cache = useRef(gateway.getSnapshot());
  const subscribe = useCallback((onChange: () => void) => gateway.subscribe(() => {
    cache.current = gateway.getSnapshot();
    onChange();
  }), [gateway]);
  const get = useCallback(() => cache.current, []);
  return useSyncExternalStore(subscribe, get, get);
}
function FamilyGate({ runtime, children }: { runtime: PhoneDemoRuntime; children: ReactNode }) {
  const t = useMessages(driverMessages);
  const snap = useFamily(runtime.familyGateway);
  const [failed, setFailed] = useState(false);
  const starting = useRef(false);
  if (snap.state === 'authenticated') return <>
    <p className="andes-hint tandem-note" data-contact-session>{t('contactNote')}</p>{children}</>;
  return <section className="tandem-flow"><h1>{t('contactTitle')}</h1><p>{t('contactBody')}</p>
    {(failed || snap.state === 'error') && <p role="alert">{t('contactFailed')}</p>}
    {snap.state === 'expired' && <p role="alert">{t('sessionExpired')}</p>}
    <PrimaryAction data-action="start-contact" busy={snap.state === 'connecting'} onClick={() => {
      if (starting.current || runtime.familyGateway.getSnapshot().state === 'connecting') return;
      starting.current = true; setFailed(false);
      void runtime.familyGateway.begin?.().then(() => setFailed(false), () => setFailed(true))
        .finally(() => { starting.current = false; });
    }}>{t('contactOpen')}</PrimaryAction></section>;
}
function familyPage(runtime: PhoneDemoRuntime, page: ComponentType<FeatureRouteProps> | undefined) {
  return function ContactRoute(props: FeatureRouteProps) {
    return <FamilyGate runtime={runtime}>{page ? createElement(page, props) : null}</FamilyGate>;
  };
}

/** Driver screens own the journey controller. Contact routes keep their own view. */
export function createPhoneRoutes(runtime: PhoneDemoRuntime): FeatureRoutes {
  const driverContacts = createContactRoutes({ api: runtime.api, session: runtime.session, gateway: runtime.gateway });
  const familyContacts = createContactRoutes({ api: runtime.familyApi, session: runtime.familySession, gateway: runtime.familyGateway });
  return {
    home: () => <Home runtime={runtime} />,
    trucks: () => <Trucks runtime={runtime} />,
    tripNew: () => <Prepare runtime={runtime} />,
    activeTrip: ({ params }) => <TripHome runtime={runtime} tripId={params.tripId!} />,
    checkIn: ({ params }) => <CheckIn runtime={runtime} tripId={params.tripId!} />,
    alerts: ({ params }) => <Alerts runtime={runtime} tripId={params.tripId!} />,
    summary: ({ params }) => <Summary runtime={runtime} tripId={params.tripId!} />,
    contacts: driverContacts.contacts,
    privacy: driverContacts.privacy,
    invitation: familyPage(runtime, familyContacts.invitation),
    contactTrip: familyPage(runtime, familyContacts.contactTrip),
  };
}
