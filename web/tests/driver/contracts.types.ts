// Compile only: no credentials, network, browser or server are started.
import { createDriverJourney, type DriverRequest, type TransportResult } from '../../src/features/driver/controller.mjs';

const transport = async (_request: DriverRequest, _options: { signal: AbortSignal }): Promise<TransportResult> =>
  ({ kind: 'unknown', code: 'compile-only' });
const journey = createDriverJourney({ transport });
journey.setSession('00000000-0000-4000-8000-000000000001');
journey.setInteractionMode('stationary');
journey.editForm({ fields: { locale: 'pt-BR', country: 'BR', timeZone: 'America/Sao_Paulo' } });
void journey.confirmTrip({ confirmed: true });
void journey.retryUnknown('confirm', { confirmed: true });
void journey.sendCommand('rest_report');
void journey.refreshStatus();
journey.editForm({ fields: { expectedArrivalAt: '2026-10-18T15:30:00.000Z' } });
const zeroDispatch: TransportResult = { kind: 'not_sent', code: 'no_session' };
void zeroDispatch;
createDriverJourney({ decodeResponse: (_request, data) => data });
journey.setPermission('geolocation', 'revoked');
const state = journey.snapshot();
const zone: string = state.form.fields.timeZone;
const sourceTime: null | undefined = state.operations.command?.sourceTime;
void zone; void sourceTime;

// @ts-expect-error No invented safety-classification command.
void journey.sendCommand('driver_safe');
// @ts-expect-error No inferred movement/interaction state.
journey.setInteractionMode('automatically-safe');
// @ts-expect-error Only actual stream permission states.
journey.setPermission('camera', 'granted');
// @ts-expect-error Audio is not draft input.
journey.editForm({ audio: 'transcribe-this' });
// @ts-expect-error Unknown writes require an actual named operation slot.
void journey.retryUnknown('delivery', { confirmed: true });
