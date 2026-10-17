import type * as T from './types.ts';

export type Decoder<T> = (value: unknown) => T;
function invalid(): never { throw new Error('Unexpected API response'); }
const text: Decoder<string> = value => typeof value === 'string' ? value : invalid();
const bool: Decoder<boolean> = value => typeof value === 'boolean' ? value : invalid();
const uuid: Decoder<string> = value => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : invalid();
const date: Decoder<string> = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.test(value)
  && Number.isFinite(Date.parse(value)) ? value : invalid();
const number = (min: number, max = Infinity, integer = false): Decoder<number> => value =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  && (!integer || Number.isInteger(value)) ? value : invalid();
const literal = <T extends string | boolean>(expected: T): Decoder<T> => value => value === expected ? expected : invalid();
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
  destination: optional(text), country: optional(text), locale: optional(text), timeZone: optional(text) });
const commands = choice<T.TripCommand>('arrived', 'cancel', 'pause', 'resume', 'checkin_ok', 'rest_report');

export const id: Decoder<T.IdResponse> = object({ id: uuid });
export const pending: Decoder<T.PendingInvitation> = object({ id: uuid, status: literal('pending') });
export const accepted: Decoder<T.AcceptedInvitation> = object({ id: uuid, map: bool, incident: bool, status: literal('accepted') });
export const revoked: Decoder<T.RevokedInvitation> = object({ id: uuid, revoked: literal(true) });
export const tripRevoked: Decoder<T.RevokedTripGrant> = object({ id: uuid, tripId: uuid, revoked: literal(true) });
export const draft: Decoder<T.TripDraft> = object({ id: uuid, status: literal('draft'), rawText: text, fields,
  missingFields: array(choice<keyof T.TripFields>('truckId', 'origin', 'destination', 'country', 'locale', 'timeZone')) });
export const confirmed: Decoder<T.ConfirmedTrip> = object({ id: uuid, status: literal('active'), fields: object(fullFields) });
export const command: Decoder<T.CommandResult> = object({ id: uuid, command: commands, automaticEscalation: literal(false) });
export const trip: Decoder<T.Trip> = object({ id: uuid, driver_id: uuid, truck_id: uuid, origin: text, destination: text,
  country: text, locale: text, time_zone: text, status: choice('active', 'arrived', 'cancelled'), map_active: bool,
  checkins_active: bool, paused: bool, version: number(1, Infinity, true), created_at: date, closed_at: nullable(date) });
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
  return { tripId: parsed.tripId, readAt: parsed.readAt, location: parsed.location, freshness: parsed.freshness, ageMs: parsed.ageMs };
};
