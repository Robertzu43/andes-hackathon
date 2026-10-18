export type InteractionMode = 'unknown' | 'moving' | 'stationary' | 'allowed-assistance';
export type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'revoked';
export type Command = 'arrived' | 'cancel' | 'pause' | 'resume' | 'checkin_ok' | 'rest_report';
export type WriteSlot = 'truck' | 'draft' | 'confirm' | 'command' | 'sos' | 'resolve';
export type Operation = 'createTruck' | 'createDraft' | 'confirmDraft' | 'command' | 'sos' | 'resolveIncident' | 'readTrip' | 'readSnapshot' | 'readIncident' | 'readStatus';
export interface DraftFields {
  truckId?: string; origin?: string; destination?: string;
  country?: string; locale?: string; timeZone?: string; expectedArrivalAt?: string;
}
/** Local operation descriptor, not an HTTP endpoint or frozen lane45 transport interface. */
export interface DriverRequest {
  operation: Operation;
  params: { id?: string };
  body?: Record<string, unknown>;
  idempotencyKey?: string;
}
export type TransportResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'not_sent'; code: string }
  | { kind: 'rejected'; status: number; code: string }
  | { kind: 'unknown'; code?: string; status?: number; responseCode?: string };
export type Outcome = TransportResult | { kind: 'blocked'; code: string; errors?: Record<string, string> };
export type LocalOutcome = { kind: 'local-state' } | { kind: 'blocked'; code: string };
export interface SelectionEvidence {
  actorId: string;
  source: 'authenticated-server-read';
  readAt: string;
  trucks: { id: string; label: string }[];
  contacts: { id: string; status: 'pending' | 'accepted' | 'revoked' | 'unknown'; map: boolean; incident: boolean }[];
}
export interface Fact<T = Record<string, unknown>> {
  state: 'not-loaded' | 'loading' | 'available' | 'unavailable';
  data: T | null;
  clientReceivedAtMs: number | null;
  invalidated: boolean;
  error: TransportResult | { code: string } | null;
}
export interface Activation {
  data: { id: string; status: 'active'; fields: DraftFields };
  invalidated: boolean; source: 'confirm-response'; sourceTime: null; clientReceivedAtMs: number | null;
}
export interface JourneyFacts { trip: Fact; location: Fact; incident: Fact; status: Fact; activation: Activation | null }
export interface JourneySnapshot extends JourneyFacts {
  disposed: boolean;
  auth: { state: 'unknown' | 'authenticated' | 'expired'; actorId: string | null };
  interaction: InteractionMode;
  network: 'unknown' | 'online' | 'offline';
  permissions: { geolocation: PermissionState; motion: PermissionState };
  form: { text: string; fields: Required<DraftFields>; contactGrantIds: string[] };
  selection: SelectionEvidence | null;
  draft: { id: string; status: 'draft'; rawText: string; fields: DraftFields; missingFields: string[] } | null;
  tripId: string | null;
  monitoring: unknown;
  operations: Partial<Record<WriteSlot, {
    state: 'pending' | 'accepted' | 'rejected' | 'unknown' | 'not_sent';
    request: DriverRequest; result: TransportResult | null; clientReceivedAtMs: number | null; sourceTime: null;
  }>>;
}
export interface DriverJourney {
  snapshot(): JourneySnapshot;
  setSession(actorId?: string | null): LocalOutcome;
  setInteractionMode(mode: InteractionMode): LocalOutcome;
  setNetwork(network: 'unknown' | 'online' | 'offline'): LocalOutcome;
  setPermission(stream: 'geolocation' | 'motion', state: PermissionState): LocalOutcome;
  provideSelectionEvidence(evidence: SelectionEvidence): LocalOutcome;
  editForm(patch: { text?: string; fields?: DraftFields }): LocalOutcome;
  selectContacts(grantIds: string[]): LocalOutcome;
  registerTruck(label: string): Promise<Outcome>;
  saveDraft(): Promise<Outcome>;
  confirmTrip(options?: { confirmed?: boolean }): Promise<Outcome>;
  sendCommand(command: Command, options?: { newIntent?: boolean }): Promise<Outcome>;
  requestHelp(): Promise<Outcome>;
  resolveIncident(): Promise<Outcome>;
  retryUnknown(slot: WriteSlot, options?: { confirmed?: boolean }): Promise<Outcome>;
  openTrip(id: string): Promise<Outcome>;
  refreshStatus(): Promise<Outcome>;
  refreshLocation(): Promise<Outcome>;
  refreshIncident(id?: string): Promise<Outcome>;
  subscribe(listener: (snapshot: JourneySnapshot) => void): () => void;
  dispose(): void;
}
export function createDriverJourney(options?: {
  transport?: ((request: DriverRequest, options: { signal: AbortSignal }) => Promise<TransportResult>) | null;
  clock?: () => number;
  keyFactory?: () => string;
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
  requestTimeoutMs?: number;
  decodeResponse?: ((request: DriverRequest, data: unknown) => unknown) | null;
  monitoringProjection?: ((facts: JourneyFacts, clientNowMs: number | null) => unknown) | null;
}): DriverJourney;
