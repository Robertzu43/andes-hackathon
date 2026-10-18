import { normalizeDate } from './responses.ts';
import { isUuid } from './uuid.ts';
import type { ConsentScopes, UUID } from './types.ts';

export interface ContactInvitation {
  id: UUID;
  driverId: UUID;
  requested: ConsentScopes;
  accepted: ConsentScopes;
  status: 'pending' | 'accepted' | 'revoked';
  acceptedAt: string | null;
  revokedAt: string | null;
}
export interface ContactTrip {
  tripId: UUID;
  grantId: UUID;
  driverId: UUID;
  status: 'active' | 'arrived' | 'cancelled';
  scopes: ConsentScopes;
  activeIncidentId: UUID | null;
}
export interface ContactInvitations { readAt: string; limit: 100; hasMore: boolean; invitations: ContactInvitation[] }
export interface ContactTrips { readAt: string; limit: 100; hasMore: boolean; trips: ContactTrip[] }

function invalid(): never { throw new Error('Unexpected API response'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): UUID { return isUuid(value) ? value : invalid(); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid();
  normalizeDate(value);
  return value;
}
const nullableDate = (value: unknown) => value === null ? null : instant(value);
function scopes(value: unknown): ConsentScopes {
  const row = object(value);
  return { map: bool(row.map), incident: bool(row.incident) };
}
function invitation(value: unknown): ContactInvitation {
  const row = object(value);
  const status = row.status;
  if (status !== 'pending' && status !== 'accepted' && status !== 'revoked') invalid();
  const result: ContactInvitation = { id: uuid(row.id), driverId: uuid(row.driverId), requested: scopes(row.requested),
    accepted: scopes(row.accepted), status, acceptedAt: nullableDate(row.acceptedAt), revokedAt: nullableDate(row.revokedAt) };
  if ((result.accepted.map && !result.requested.map) || (result.accepted.incident && !result.requested.incident)) invalid();
  if ((status === 'revoked') !== (result.revokedAt !== null)) invalid();
  if (status === 'pending' && (result.acceptedAt !== null || result.accepted.map || result.accepted.incident)) invalid();
  if (status === 'accepted' && (result.acceptedAt === null || (!result.accepted.map && !result.accepted.incident))) invalid();
  return result;
}
function trip(value: unknown): ContactTrip {
  const row = object(value);
  const status = row.status;
  if (status !== 'active' && status !== 'arrived' && status !== 'cancelled') invalid();
  return { tripId: uuid(row.tripId), grantId: uuid(row.grantId), driverId: uuid(row.driverId), status,
    scopes: scopes(row.scopes), activeIncidentId: row.activeIncidentId === null ? null : uuid(row.activeIncidentId) };
}
function envelope(value: unknown) {
  const row = object(value);
  if (row.limit !== 100) invalid();
  return { readAt: instant(row.readAt), limit: 100 as const, hasMore: bool(row.hasMore) };
}
function rows<T>(value: unknown, decode: (value: unknown) => T, key: (row: T) => string): T[] {
  if (!Array.isArray(value) || value.length > 100) invalid();
  const result = value.map(decode);
  if (new Set(result.map(row => key(row).toLowerCase())).size !== result.length) invalid();
  return result;
}
/** A truncated catalog is incomplete; absence never establishes permission or membership. */
export function decodeContactInvitations(value: unknown): ContactInvitations {
  return { ...envelope(value), invitations: rows(object(value).invitations, invitation, row => row.id) };
}
export function decodeContactTrips(value: unknown): ContactTrips {
  return { ...envelope(value), trips: rows(object(value).trips, trip, row => `${row.tripId}:${row.grantId}`) };
}
