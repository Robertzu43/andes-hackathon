import type { ApiClient } from './client.ts';
import { ApiError } from './errors.ts';
import type { ConfirmTripInput, DraftInput, TripCommand } from './types.ts';
import * as decode from './responses.ts';

/** Structural descriptor port published by driver PR63/c256e75; no feature imports. */
export interface DriverRequest {
  operation: 'createTruck' | 'createDraft' | 'confirmDraft' | 'command' | 'sos' | 'readTrip' | 'readSnapshot' | 'readIncident' | 'readStatus';
  params: { id?: string };
  body?: Record<string, unknown>;
  idempotencyKey?: string;
}
export type DriverTransportResult = { kind: 'ok'; data: unknown }
  | { kind: 'not_sent'; code: string }
  | { kind: 'rejected'; status: number; code: string }
  | { kind: 'unknown'; code: string; status?: number };

/** Shared wire validation for a feature's injected decoder; correlation stays feature-owned. */
export function decodeDriverResponse(request: Pick<DriverRequest, 'operation'>, value: unknown): unknown {
  const decoders = { createTruck: decode.id, createDraft: decode.draft, confirmDraft: decode.confirmed,
    command: decode.command, sos: decode.sos, readTrip: decode.trip,
    readSnapshot: decode.snapshot, readIncident: decode.incident, readStatus: decode.tripStatus };
  const decodeOperation = decoders[request.operation as keyof typeof decoders];
  if (!decodeOperation) throw new ApiError('unsupported', {
    operation: request.operation, code: 'unsupported_operation', outcome: 'not_applicable',
  });
  try { return decodeOperation(value); }
  catch { throw new ApiError('invalid_response', { operation: request.operation,
    outcome: request.operation.startsWith('read') ? 'not_applicable' : 'unknown' }); }
}

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
        case 'readStatus': data = await api.getTripStatus(id, read); break;
        default: return { kind: 'not_sent', code: 'unsupported_operation' };
      }
      return { kind: 'ok', data };
    } catch (error) {
      if (!(error instanceof ApiError)) return { kind: 'unknown', code: 'client_binding_error' };
      if (error.outcome === 'not_sent') return { kind: 'not_sent', code: error.code };
      if (error.status !== null && error.status >= 400 && error.status < 500
        && (error.outcome === 'rejected' || error.outcome === 'not_applicable')) {
        return { kind: 'rejected', status: error.status, code: error.code };
      }
      return { kind: 'unknown', code: error.code, ...(error.status === null ? {} : { status: error.status }) };
    }
  };
}
