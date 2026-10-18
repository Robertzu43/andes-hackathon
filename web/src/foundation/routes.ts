import type { MessageKey } from './messages.ts';
import { isUuid } from '../lib/api/uuid.ts';
export const routeDefinitions = [
  { id: 'home', path: '/', title: 'home' },
  { id: 'session', path: '/session', title: 'session' },
  { id: 'trucks', path: '/trucks', title: 'trucksTitle' },
  { id: 'contacts', path: '/contacts', title: 'contactsTitle' },
  { id: 'tripNew', path: '/trips/new', title: 'tripNew' },
  { id: 'activeTrip', path: '/trips/:tripId', title: 'activeTrip' },
  { id: 'checkIn', path: '/trips/:tripId/check-in', title: 'checkIn' },
  { id: 'alerts', path: '/trips/:tripId/alerts', title: 'alerts' },
  { id: 'contactTrip', path: '/contact/trips/:tripId', title: 'contactTrip' },
  { id: 'invitation', path: '/contact/invitations/:grantId', title: 'invitation' },
  { id: 'summary', path: '/trips/:tripId/summary', title: 'summary' },
  { id: 'privacy', path: '/privacy', title: 'privacy' },
] as const satisfies readonly { id: string; path: string; title: MessageKey }[];
export type RouteId = (typeof routeDefinitions)[number]['id'];
export function validRouteParams(params: Readonly<Record<string, string | undefined>>): boolean {
  return Object.entries(params).every(([name, value]) => !['tripId', 'grantId'].includes(name) || isUuid(value));
}
