import type { ApiClient } from './client.ts';
import { ApiError } from './errors.ts';
import type { ConfirmTripInput, DraftInput, TripCommand } from './types.ts';

/** Structural descriptor port published by driver PR63/c256e75; no feature imports. */
export interface DriverRequest {
  operation: 'createTruck' | 'createDraft' | 'confirmDraft' | 'command' | 'sos' | 'readTrip' | 'readSnapshot' | 'readIncident';
  params: { id?: string };
  body?: Record<string, unknown>;
  idempotencyKey?: string;
}
export type DriverTransportResult = { kind: 'ok'; data: unknown }
  | { kind: 'rejected'; status: number; code: string }
  | { kind: 'unknown'; code: string; status?: number };

/** Single-call translation; original intent ownership and retry decisions stay with the controller. */
export function createDriverTransport(api: ApiClient) {
  return async (request: DriverRequest, options: { signal: AbortSignal }): Promise<DriverTransportResult> => {
    try {
      const read = { signal: options.signal };
      const write = { ...read, idempotencyKey: request.idempotencyKey as string };
      const id = request.params?.id as string;
      const body = request.body;
      let data: unknown;
      // The descriptor is already validated by the controller; the backend remains
      // authoritative for strict body schemas, ownership, consent and idempotency.
      switch (request.operation) {
        case 'createTruck': data = await api.createTruck(body as { label: string }, write); break;
        case 'createDraft': data = await api.createDraft(body as unknown as DraftInput, write); break;
        case 'confirmDraft': data = await api.confirmTrip(id, body as unknown as ConfirmTripInput, write); break;
        case 'command': data = await api.commandTrip(id, body?.type as TripCommand, write); break;
        case 'sos': data = await api.reportSos(id, write); break;
        case 'readTrip': data = await api.getTrip(id, read); break;
        case 'readSnapshot': data = await api.getSnapshot(id, read); break;
        case 'readIncident': data = await api.getIncident(id, read); break;
        default: return { kind: 'unknown', code: 'unsupported_operation' };
      }
      return { kind: 'ok', data };
    } catch (error) {
      if (!(error instanceof ApiError)) return { kind: 'unknown', code: 'client_binding_error' };
      if (error.status !== null && [400, 401, 403, 404, 409, 422].includes(error.status)
        && (error.outcome === 'rejected' || error.outcome === 'not_applicable')) {
        return { kind: 'rejected', status: error.status, code: error.code };
      }
      return { kind: 'unknown', code: error.code, ...(error.status === null ? {} : { status: error.status }) };
    }
  };
}
