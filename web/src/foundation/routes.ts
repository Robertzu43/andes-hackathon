import type { MessageKey } from './messages.ts';
export const routeDefinitions = [
  { id: 'home', path: '/', title: 'home', owner: 50 },
  { id: 'session', path: '/session', title: 'session', owner: 49 },
  { id: 'trucks', path: '/trucks', title: 'trucksTitle', owner: 50 },
  { id: 'contacts', path: '/contacts', title: 'contactsTitle', owner: 51 },
  { id: 'tripNew', path: '/trips/new', title: 'tripNew', owner: 50 },
  { id: 'activeTrip', path: '/trips/:tripId', title: 'activeTrip', owner: 50 },
  { id: 'checkIn', path: '/trips/:tripId/check-in', title: 'checkIn', owner: 50 },
  { id: 'alerts', path: '/trips/:tripId/alerts', title: 'alerts', owner: 50 },
  { id: 'contactTrip', path: '/contact/trips/:tripId', title: 'contactTrip', owner: 51 },
  { id: 'invitation', path: '/contact/invitations/:grantId', title: 'invitation', owner: 51 },
  { id: 'summary', path: '/trips/:tripId/summary', title: 'summary', owner: 50 },
  { id: 'privacy', path: '/privacy', title: 'privacy', owner: 51 },
] as const satisfies readonly { id: string; path: string; title: MessageKey; owner: number }[];
export type RouteId = (typeof routeDefinitions)[number]['id'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validRouteParams(params: Readonly<Record<string, string | undefined>>): boolean {
  return Object.entries(params).every(([name, value]) => !['tripId', 'grantId'].includes(name) || typeof value === 'string' && uuid.test(value));
}
export function routePath(id: RouteId, params: Readonly<Record<string, string>> = {}): string {
  const route = routeDefinitions.find(item => item.id === id);
  if (!route) throw new Error('Unknown route');
  return route.path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = params[name];
    if (!value || !uuid.test(value)) throw new Error(`Invalid route parameter: ${name}`);
    return encodeURIComponent(value);
  });
}
