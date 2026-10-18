/** Public catalog DTOs. Phone values are deliberately absent, including for demo identities. */
export interface ClientProfile { id: string; phoneVerified: boolean }
export interface ClientTruck { id: string; label: string }
export interface ClientContact {
  id: string;
  contactId: string;
  role: 'family' | 'colleague' | null;
  map: { requested: boolean; accepted: boolean };
  incident: { requested: boolean; accepted: boolean };
  status: 'pending' | 'accepted' | 'revoked';
  acceptedAt: string | null;
  revokedAt: string | null;
  revokedBy: 'driver' | 'contact' | null;
}
/** Bounded owner projection, not the runtime /status check/incident/delivery envelope. */
export interface ClientTripSummary {
  id: string;
  truckId: string;
  origin: string;
  destination: string;
  country: string;
  locale: string;
  timeZone: string;
  status: 'active' | 'arrived' | 'cancelled';
  mapActive: boolean;
  checkinsActive: boolean;
  paused: boolean;
  version: number;
  createdAt: string;
  closedAt: string | null;
  expectedArrivalAt: string | null;
  sharingStoppedAt: string | null;
  contactGrantIds: string[];
}
export interface ClientPage { limit: number; hasMore: boolean }
export interface ClientTrucks extends ClientPage { trucks: ClientTruck[] }
export interface ClientContacts extends ClientPage { contacts: ClientContact[] }
export interface ClientTrips {
  active: ClientTripSummary[];
  recent: ClientTripSummary[];
  limits: { active: number; recent: number };
  hasMore: { active: boolean; recent: boolean };
}
export type ClientRead<T> = T & { readAt: string };
export interface ClientBootstrap {
  profile: ClientProfile;
  trucks: ClientTruck[];
  contacts: ClientContact[];
  trips: Pick<ClientTrips, 'active' | 'recent'>;
  limits: { trucks: number; contacts: number; activeTrips: number; recentTrips: number };
  hasMore: { trucks: boolean; contacts: boolean; activeTrips: boolean; recentTrips: boolean };
}
