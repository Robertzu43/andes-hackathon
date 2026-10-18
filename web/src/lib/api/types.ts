/** Wire types from backend ebc8fb1; dates are serialized strings, never client Date objects. */
export type UUID = string;
export interface ConsentScopes { map: boolean; incident: boolean }
export interface TripFields {
  truckId: UUID; origin: string; destination: string; country: string; locale: string; timeZone: string;
  expectedArrivalAt?: string;
}
export interface IdResponse { id: UUID }
export type ContactRole = 'family' | 'colleague';
export interface InvitationInput extends ConsentScopes { contactId: UUID; phone: string; role?: ContactRole }
export interface PendingInvitation extends IdResponse { status: 'pending' }
export interface AcceptedInvitation extends IdResponse, ConsentScopes { status: 'accepted' }
export interface RevokedInvitation extends IdResponse { revoked: true }
export interface RevokedTripGrant extends RevokedInvitation { tripId: UUID }
export interface DraftInput { text: string; fields?: Partial<TripFields> }
export interface TripDraft extends IdResponse {
  rawText: string; fields: Partial<TripFields>; missingFields: Exclude<keyof TripFields, 'expectedArrivalAt'>[]; status: 'draft';
}
/** Explicit literal confirmation is mandatory; creating a draft never activates a trip. */
export interface ConfirmTripInput { confirmed: true; contactGrantIds: UUID[]; fields?: Partial<TripFields> }
export interface ConfirmedTrip extends IdResponse { status: 'active'; fields: TripFields }
export type TripCommand = 'arrived' | 'cancel' | 'pause' | 'resume' | 'checkin_ok' | 'rest_report';
export interface CommandResult extends IdResponse { command: TripCommand; automaticEscalation: false }
export interface Trip extends IdResponse {
  driver_id: UUID; truck_id: UUID; origin: string; destination: string; country: string; locale: string;
  time_zone: string; status: 'active' | 'arrived' | 'cancelled'; map_active: boolean;
  checkins_active: boolean; paused: boolean; version: number; created_at: string; closed_at: string | null;
  expected_arrival_at?: string | null; sharing_stopped_at?: string | null;
}
export interface LocationObservation { capturedAt: string; latitude: number; longitude: number; accuracy: number }
export interface ReceivedLocation extends LocationObservation { receivedAt: string }
export type LocationSnapshot = { tripId: UUID; readAt: string } & (
  { location: null; freshness: 'unavailable'; ageMs: null }
  | { location: ReceivedLocation; freshness: 'fresh' | 'stale'; ageMs: number }
);
export interface IncidentSummary extends IdResponse {
  tripId: UUID; status: 'active' | 'resolved'; createdAt: string; resolvedAt: string | null;
  groupCapability: 'unavailable';
}
export interface SosResult extends IdResponse { tripId: UUID; status: 'active'; groupCapability: 'unavailable' }
export interface AcknowledgementResult extends IdResponse { status: 'active'; recorded: 'acknowledged' }
/** A reported action is attributed information, not independent confirmation of help. */
export interface ActionResult extends IdResponse { status: 'active'; recorded: 'action' }
export interface ResolutionResult extends IdResponse { status: 'resolved' }
export interface RequestOptions { signal?: AbortSignal }
/** Generate once per explicit intent; preserve the key and payload when reconciling ambiguity. */
export interface WriteOptions extends RequestOptions { idempotencyKey: string }

/** Actual additive runtime contract at Robert PR74/4c138ca. No client policy clock. */
export type CheckReason = 'sharing_stopped' | 'silence' | 'arrival_overdue';
export interface SharingInput {
  state: 'stopped' | 'resumed'; reason: 'user' | 'page_hidden' | 'permission_denied' | 'error';
}
export interface SharingResult extends IdResponse { sharing: 'stopped' | 'resumed' }
export interface TripStatus {
  trip: { status: 'active' | 'arrived' | 'cancelled'; paused: boolean; expectedArrivalAt: string | null };
  check: { status: 'asking'; reason: CheckReason; askUntil: string } | null;
  incident: { id: UUID; trigger: 'sos' | 'missed_check'; checkReason: CheckReason | null;
    status: 'active' | 'resolved'; createdAt: string } | null;
  deliveries: { role: 'family' | 'colleague' | 'group'; channel: 'sms' | 'whatsapp' | 'voice' | 'group';
    status: 'pending' | 'claimed' | 'authorized' | 'accepted' | 'rejected' | 'unknown' | 'delivered' | 'cancelled' | 'unavailable';
    unavailableReason: string | null }[];
  /** Omitted when current scope/map state does not permit location. No coordinates. */
  location?: { freshness: 'fresh' | 'stale' | 'unavailable'; ageMs: number | null; capturedAt: string | null; accuracy: number | null };
}
export type DemoPersona = 'driver' | 'family' | 'colleague';
/** Sensitive wire result for a trusted demo host. Never render, persist or log tokens. */
export interface DemoWorld {
  synthetic: true; expiresInSeconds: 7200;
  driver: { id: UUID; token: string; truckId: UUID };
  family: { id: UUID; token: string; grantId: UUID };
  colleague: { id: UUID; token: string; grantId: UUID };
}
/** Explicit demo-only exception: unauthenticated POST, no actor/idempotency key yet. */
export interface DemoSessionOptions extends RequestOptions { demo: true }

/** PR65/de9e455 supplies its server read-start timestamp; never substitute a local clock. */
export interface ServerRead { readAt: string }
/** Catalogs never carry a phone value. */
export interface Profile extends IdResponse, ServerRead { phoneVerified: boolean }
export interface TruckSummary extends IdResponse { label: string }
export interface ContactSummary extends IdResponse {
  contactId: UUID; role: ContactRole;
  map: { requested: boolean; accepted: boolean };
  incident: { requested: boolean; accepted: boolean };
  status: 'pending' | 'accepted' | 'revoked';
  acceptedAt: string | null; revokedAt: string | null; revokedBy: 'driver' | 'contact' | null;
}
export interface TripSummary extends IdResponse, Omit<TripFields, 'expectedArrivalAt'> {
  status: 'active' | 'arrived' | 'cancelled'; mapActive: boolean; checkinsActive: boolean;
  paused: boolean; version: number; createdAt: string; closedAt: string | null;
  expectedArrivalAt: string | null; sharingStoppedAt: string | null; contactGrantIds: UUID[];
}
export interface TruckList extends ServerRead { trucks: TruckSummary[]; limit: 100; hasMore: boolean }
export interface ContactList extends ServerRead { contacts: ContactSummary[]; limit: 100; hasMore: boolean }
export interface TripList extends ServerRead {
  active: TripSummary[]; recent: TripSummary[];
  limits: { active: 50; recent: 20 }; hasMore: { active: boolean; recent: boolean };
}
export interface Bootstrap extends ServerRead {
  profile: Omit<Profile, 'readAt'>; trucks: TruckSummary[]; contacts: ContactSummary[];
  trips: { active: TripSummary[]; recent: TripSummary[] };
  limits: { trucks: 100; contacts: 100; activeTrips: 50; recentTrips: 20 };
  hasMore: { trucks: boolean; contacts: boolean; activeTrips: boolean; recentTrips: boolean };
}
