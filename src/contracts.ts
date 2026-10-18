import type pg from 'pg';
export type Channel = 'sms' | 'whatsapp' | 'voice';
export type CheckReason = 'arrival_overdue' | 'silence' | 'sharing_stopped';
export interface ChannelSupport { channel: Channel; country: string; locale: string }
/** phone/phoneVerified are this token's claim (null when absent, as in demo tokens); the identities row holds the verified binding. */
export interface Actor { id: string; phone: string | null; phoneVerified: boolean }
export interface Trip extends pg.QueryResultRow {
  id: string; driver_id: string; truck_id: string; country: string; locale: string;
  status: 'active' | 'arrived' | 'cancelled'; map_active: boolean; checkins_active: boolean; paused: boolean; version: number;
  expected_arrival_at: Date | null; sharing_stopped_at: Date | null;
}
export interface Job extends pg.QueryResultRow {
  id: string; trip_id: string; incident_id: string | null; grant_id: string | null; recipient_id: string | null;
  channel: Channel | 'group'; class: 'emergency' | 'ordinary'; version: number;
  status: 'pending' | 'claimed' | 'authorized' | 'accepted' | 'rejected' | 'unknown' | 'delivered' | 'cancelled' | 'unavailable';
  expires_at: Date | null;
}
export interface Outbox extends pg.QueryResultRow {
  id: string; job_id: string; job_version: number; class: 'emergency' | 'ordinary';
  published_at: Date | null; lease_owner: string | null; lease_until: Date | null; next_publish_at: Date;
}
export interface DraftFields { truckId?: string; origin?: string; destination?: string; country?: string; locale?: string; timeZone?: string; expectedArrivalAt?: string }
/** Qualification entries are canonical; trips stored before canonical storage may not be ('pt-br'), so compare canonically. */
export function canonicalLocale(tag: string): string { try { return Intl.getCanonicalLocales(tag)[0] ?? tag; } catch { return tag; } }
export function problem(statusCode: number, code: string, reason?: string): never { throw Object.assign(new Error(code), { statusCode, code, ...(reason ? { reason } : {}) }); }
export function owner(trip: Trip, actor: Actor) { if (trip.driver_id !== actor.id) problem(403, 'forbidden'); }
