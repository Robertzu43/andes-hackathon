/** Wire types from backend ebc8fb1; dates are serialized strings, never client Date objects. */
export type UUID = string;
export interface ConsentScopes { map: boolean; incident: boolean }
export interface TripFields {
  truckId: UUID; origin: string; destination: string; country: string; locale: string; timeZone: string;
}
export interface IdResponse { id: UUID }
export interface InvitationInput extends ConsentScopes { contactId: UUID; phone: string }
export interface PendingInvitation extends IdResponse { status: 'pending' }
export interface AcceptedInvitation extends IdResponse, ConsentScopes { status: 'accepted' }
export interface RevokedInvitation extends IdResponse { revoked: true }
export interface RevokedTripGrant extends RevokedInvitation { tripId: UUID }
export interface DraftInput { text: string; fields?: Partial<TripFields> }
export interface TripDraft extends IdResponse {
  rawText: string; fields: Partial<TripFields>; missingFields: (keyof TripFields)[]; status: 'draft';
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
