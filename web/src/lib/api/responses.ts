import type * as T from './types.ts';
import { isUuid } from './uuid.ts';

export type Decoder<T> = (value: unknown) => T;
function invalid(): never { throw new Error('Unexpected API response'); }
const text: Decoder<string> = value => typeof value === 'string' ? value : invalid();
const bool: Decoder<boolean> = value => typeof value === 'boolean' ? value : invalid();
const uuid: Decoder<string> = value => isUuid(value) ? value : invalid();
const instant = /^(\d{4})-(\d{2})-(\d{2})T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.\d+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/;
// Date.parse rolls impossible days forward (02-30 -> 03-02); require the calendar day to round-trip.
const realDay = (m: RegExpExecArray) => {
  const day = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return day.getUTCFullYear() === +m[1]! && day.getUTCMonth() === +m[2]! - 1 && day.getUTCDate() === +m[3]!;
};
const date: Decoder<string> = value => {
  const m = typeof value === 'string' ? instant.exec(value) : null;
  return m && realDay(m) && Number.isFinite(Date.parse(m[0])) ? m[0] : invalid();
};
/** Normalize only explicit zoned instants; never infer a browser or route time zone. */
export function normalizeDate(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const compatible = value.replace('t', 'T').replace(/z$/i, 'Z')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2').replace(/([+-]\d{2})$/, '$1:00');
  return new Date(date(compatible)).toISOString();
}
const number = (min: number, max = Infinity, integer = false): Decoder<number> => value =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  && (!integer || Number.isInteger(value)) ? value : invalid();
const literal = <T extends string | boolean | number>(expected: T): Decoder<T> => value => value === expected ? expected : invalid();
const choice = <T extends string>(...values: T[]): Decoder<T> => value =>
  values.includes(value as T) ? value as T : invalid();
const nullable = <T>(decode: Decoder<T>): Decoder<T | null> => value => value === null ? null : decode(value);
const optional = <T>(decode: Decoder<T>): Decoder<T | undefined> => value => value === undefined ? undefined : decode(value);
const array = <T>(decode: Decoder<T>): Decoder<T[]> => value => Array.isArray(value) ? value.map(decode) : invalid();
function object<S extends Record<string, Decoder<unknown>>>(fields: S): Decoder<{ [K in keyof S]: ReturnType<S[K]> }> {
  return value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
    const result: Record<string, unknown> = {};
    for (const [key, decode] of Object.entries(fields)) {
      const decoded = decode((value as Record<string, unknown>)[key]);
      if (decoded !== undefined) result[key] = decoded;
    }
    // Fields are fixed by the decoder, not copied from untrusted objects.
    return result as { [K in keyof S]: ReturnType<S[K]> };
  };
}
const fullFields = { truckId: uuid, origin: text, destination: text, country: text, locale: text, timeZone: text };
const fields: Decoder<Partial<T.TripFields>> = object({ truckId: optional(uuid), origin: optional(text),
  destination: optional(text), country: optional(text), locale: optional(text), timeZone: optional(text), expectedArrivalAt: optional(date) });
const commands = choice<T.TripCommand>('arrived', 'cancel', 'pause', 'resume', 'checkin_ok', 'rest_report');

export const id: Decoder<T.IdResponse> = object({ id: uuid });
export const pending: Decoder<T.PendingInvitation> = object({ id: uuid, status: literal('pending') });
export const accepted: Decoder<T.AcceptedInvitation> = object({ id: uuid, map: bool, incident: bool, status: literal('accepted') });
export const revoked: Decoder<T.RevokedInvitation> = object({ id: uuid, revoked: literal(true) });
export const tripRevoked: Decoder<T.RevokedTripGrant> = object({ id: uuid, tripId: uuid, revoked: literal(true) });
export const draft: Decoder<T.TripDraft> = object({ id: uuid, status: literal('draft'), rawText: text, fields,
  missingFields: array(choice<Exclude<keyof T.TripFields, 'expectedArrivalAt'>>('truckId', 'origin', 'destination', 'country', 'locale', 'timeZone')) });
export const confirmed: Decoder<T.ConfirmedTrip> = object({ id: uuid, status: literal('active'),
  fields: object({ ...fullFields, expectedArrivalAt: optional(date) }) });
export const command: Decoder<T.CommandResult> = object({ id: uuid, command: commands, automaticEscalation: literal(false) });
export const trip: Decoder<T.Trip> = object({ id: uuid, driver_id: uuid, truck_id: uuid, origin: text, destination: text,
  country: text, locale: text, time_zone: text, status: choice('active', 'arrived', 'cancelled'), map_active: bool,
  checkins_active: bool, paused: bool, version: number(1, Infinity, true), created_at: date, closed_at: nullable(date),
  expected_arrival_at: optional(nullable(date)), sharing_stopped_at: optional(nullable(date)) });
export const uploaded: Decoder<T.IdResponse & { received: number }> = object({ id: uuid, received: number(1, 100, true) });
export const sos: Decoder<T.SosResult> = object({ id: uuid, tripId: uuid, status: literal('active'), groupCapability: literal('unavailable') });
export const incident: Decoder<T.IncidentSummary> = object({ id: uuid, tripId: uuid, status: choice('active', 'resolved'),
  createdAt: date, resolvedAt: nullable(date), groupCapability: literal('unavailable') });
export const acknowledgement: Decoder<T.AcknowledgementResult> = object({ id: uuid, status: literal('active'), recorded: literal('acknowledged') });
export const action: Decoder<T.ActionResult> = object({ id: uuid, status: literal('active'), recorded: literal('action') });
export const resolution: Decoder<T.ResolutionResult> = object({ id: uuid, status: literal('resolved') });
const snapshotWire = object({ tripId: uuid, readAt: date, ageMs: nullable(number(0)),
  freshness: choice('fresh', 'stale', 'unavailable'), location: nullable(object({ capturedAt: date, receivedAt: date,
    latitude: number(-90, 90), longitude: number(-180, 180), accuracy: number(0) })) });
export const snapshot: Decoder<T.LocationSnapshot> = value => {
  const parsed = snapshotWire(value);
  if (parsed.location === null) {
    if (parsed.freshness !== 'unavailable' || parsed.ageMs !== null) invalid();
    return { tripId: parsed.tripId, readAt: parsed.readAt, location: null, freshness: 'unavailable', ageMs: null };
  }
  if (parsed.freshness === 'unavailable' || parsed.ageMs === null) invalid();
  const readMs = Date.parse(parsed.readAt);
  const capturedMs = Date.parse(parsed.location.capturedAt);
  const receivedMs = Date.parse(parsed.location.receivedAt);
  const age = Math.max(0, readMs - capturedMs);
  // The upload route accepts capture clocks up to 30s ahead of its receipt clock.
  if (capturedMs > receivedMs + 30_000 || receivedMs > readMs || parsed.ageMs !== age
    || parsed.freshness !== (age <= 120_000 ? 'fresh' : 'stale')) invalid();
  return { tripId: parsed.tripId, readAt: parsed.readAt, location: parsed.location, freshness: parsed.freshness, ageMs: parsed.ageMs };
};

const profileData: Decoder<Omit<T.Profile, 'readAt'>> = object({ id: uuid, phoneVerified: bool });
export const profile: Decoder<T.Profile> = value => ({ ...profileData(value), readAt: object({ readAt: date })(value).readAt });
const contactWire = object({ id: uuid, contactId: uuid, role: nullable(choice('family', 'colleague')),
  map: object({ requested: bool, accepted: bool }), incident: object({ requested: bool, accepted: bool }),
  status: choice('pending', 'accepted', 'revoked'), acceptedAt: nullable(date), revokedAt: nullable(date),
  revokedBy: nullable(choice('driver', 'contact')) });
const contact: Decoder<T.ContactSummary> = value => {
  const parsed = contactWire(value);
  if ((parsed.map.accepted && !parsed.map.requested) || (parsed.incident.accepted && !parsed.incident.requested)) invalid();
  if (parsed.status === 'revoked' ? parsed.revokedAt === null : parsed.revokedAt !== null || parsed.revokedBy !== null) invalid();
  if (parsed.status === 'pending' && (parsed.acceptedAt !== null || parsed.map.accepted || parsed.incident.accepted)) invalid();
  if (parsed.status === 'accepted' && (parsed.acceptedAt === null || (!parsed.map.accepted && !parsed.incident.accepted))) invalid();
  return parsed;
};
const summary: Decoder<T.TripSummary> = object({ id: uuid, ...fullFields,
  status: choice('active', 'arrived', 'cancelled'), mapActive: bool, checkinsActive: bool,
  paused: bool, version: number(1, Infinity, true), createdAt: date, closedAt: nullable(date),
  expectedArrivalAt: nullable(date), sharingStoppedAt: nullable(date), contactGrantIds: array(uuid) });
function bounded<T extends { id: string }>(decoder: Decoder<T>, max: number): Decoder<T[]> {
  return value => {
    if (!Array.isArray(value) || value.length > max) invalid();
    const result = value.map(decoder);
    if (new Set(result.map(row => row.id.toLowerCase())).size !== result.length) invalid();
    return result;
  };
}
const truckRows = bounded(object({ id: uuid, label: text }), 100);
const contactRows = bounded(contact, 100);
const activeRows: Decoder<T.TripSummary[]> = value => {
  const result = bounded(summary, 50)(value);
  if (result.some(row => row.status !== 'active')) invalid();
  return result;
};
const recentRows: Decoder<T.TripSummary[]> = value => {
  const result = bounded(summary, 20)(value);
  if (result.some(row => row.status === 'active')) invalid();
  return result;
};
export const trucks: Decoder<T.TruckList> = object({ trucks: truckRows, limit: literal(100), hasMore: bool, readAt: date });
export const contacts: Decoder<T.ContactList> = object({ contacts: contactRows, limit: literal(100), hasMore: bool, readAt: date });
export const trips: Decoder<T.TripList> = object({ active: activeRows, recent: recentRows,
  limits: object({ active: literal(50), recent: literal(20) }), hasMore: object({ active: bool, recent: bool }), readAt: date });
export const bootstrap: Decoder<T.Bootstrap> = object({ profile: profileData, trucks: truckRows, contacts: contactRows,
  trips: object({ active: activeRows, recent: recentRows }),
  limits: object({ trucks: literal(100), contacts: literal(100), activeTrips: literal(50), recentTrips: literal(20) }),
  hasMore: object({ trucks: bool, contacts: bool, activeTrips: bool, recentTrips: bool }), readAt: date });
