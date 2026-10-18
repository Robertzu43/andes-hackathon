import { createDriverJourney } from '../features/driver/controller.mjs';
import { bindJourneySession, createApiClient, createDemoSessionGateway, createDemoWorld,
  createDriverTransport, decodeDriverResponse, MemorySession } from '../lib/api/index.ts';

/** One in-memory demo world shared by the driver and the seeded family contact. */
export function createPhoneDemoRuntime(origin: string) {
  const session = new MemorySession();
  const familySession = new MemorySession();
  const api = createApiClient({ baseUrl: origin, session });
  const familyApi = createApiClient({ baseUrl: origin, session: familySession });
  const world = createDemoWorld(api);
  const gateway = createDemoSessionGateway({ api, session, persona: 'driver', world });
  const familyGateway = createDemoSessionGateway({ api: familyApi, session: familySession, persona: 'family', world });
  const journey = createDriverJourney({
    transport: createDriverTransport(api),
    decodeResponse: (request, data) => decodeDriverResponse(request, data),
  });
  const binding = bindJourneySession(session, api, actorId => { journey.setSession(actorId); });
  return { api, session, gateway, familyApi, familySession, familyGateway, journey, binding, world };
}
export type PhoneDemoRuntime = ReturnType<typeof createPhoneDemoRuntime>;
