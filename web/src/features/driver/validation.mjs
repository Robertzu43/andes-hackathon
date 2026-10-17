// Validation of explicit driver input, not extraction, ownership or consent authority.
export const FIELD_NAMES = Object.freeze(['truckId', 'origin', 'destination', 'country', 'locale', 'timeZone']);
export const COMMANDS = Object.freeze(['arrived', 'cancel', 'pause', 'resume', 'checkin_ok', 'rest_report']);
export const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const text = (value, max = 300) => typeof value === 'string' && value.length <= max && /\S/u.test(value);
export const copy = (value) => JSON.parse(JSON.stringify(value));
export const instant = (value) => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateFields(fields, { complete = false } = {}) {
  const errors = {};
  for (const name of FIELD_NAMES) {
    const value = fields[name];
    if (value === undefined || value === '') { if (complete) errors[name] = 'required'; continue; }
    if (typeof value !== 'string') { errors[name] = 'invalid'; continue; }
    if (name === 'truckId' && !uuid(value)) errors[name] = 'invalid';
    if (['origin', 'destination'].includes(name) && !text(value)) errors[name] = 'invalid';
    if (name === 'country' && !/^[A-Z]{2}$/.test(value)) errors[name] = 'explicit-country-required';
    if (name === 'locale') {
      try {
        const locale = new Intl.Locale(value);
        if (value.length > 40 || (locale.language !== 'es' && locale.baseName !== 'pt-BR')) errors[name] = 'unsupported-language';
      } catch { errors[name] = 'invalid'; }
    }
    if (name === 'timeZone') {
      try {
        if (!text(value, 80)) throw new RangeError();
        new Intl.DateTimeFormat('en', { timeZone: value });
      } catch { errors[name] = 'invalid'; }
    }
  }
  return errors;
}

export function inputFields(fields) {
  return Object.fromEntries(FIELD_NAMES.filter((name) => fields[name] !== undefined && fields[name] !== '')
    .map((name) => [name, name === 'truckId' ? fields[name].toLowerCase() : fields[name]]));
}

// Host-normalized selection evidence. It is not a new HTTP response contract.
export function selectionEvidence(value, actorId) {
  if (!object(value) || value.actorId !== actorId || value.source !== 'authenticated-server-read' ||
      !instant(value.readAt) || !Array.isArray(value.trucks) || value.trucks.length > 2 ||
      !Array.isArray(value.contacts) || value.contacts.length > 100) return null;
  if (value.trucks.some((truck) => !uuid(truck?.id) || !text(truck.label)) ||
      new Set(value.trucks.map((truck) => truck.id.toLowerCase())).size !== value.trucks.length) return null;
  if (value.contacts.some((contact) => !uuid(contact?.id) ||
      !['pending', 'accepted', 'revoked', 'unknown'].includes(contact.status) ||
      typeof contact.map !== 'boolean' || typeof contact.incident !== 'boolean') ||
      new Set(value.contacts.map((contact) => contact.id.toLowerCase())).size !== value.contacts.length) return null;
  return { actorId, source: value.source, readAt: value.readAt,
    trucks: value.trucks.map(({ id, label }) => ({ id: id.toLowerCase(), label })),
    contacts: value.contacts.map(({ id, status, map, incident }) => ({ id: id.toLowerCase(), status, map, incident })) };
}

export function acceptedGrantIds(ids, evidence) {
  if (!Array.isArray(ids) || ids.length > 10 || ids.some((id) => !uuid(id))) return null;
  const normalized = ids.map((id) => id.toLowerCase()).sort();
  if (new Set(normalized).size !== normalized.length) return null;
  if (normalized.length && (!evidence || normalized.some((id) => !evidence.contacts.some((contact) =>
    contact.id === id && contact.status === 'accepted' && (contact.map || contact.incident))))) return null;
  return normalized;
}

// Successful transport data must describe the specific submitted operation.
export function responseData(request, data, actorId) {
  if (!object(data)) return null;
  const { operation, params = {}, body = {} } = request;
  if (operation === 'createTruck') return uuid(data.id) ? { id: data.id.toLowerCase() } : null;
  if (operation === 'createDraft') {
    if (!uuid(data.id) || data.status !== 'draft' || data.rawText !== body.text || !object(data.fields) ||
        Object.keys(data.fields).some((key) => !FIELD_NAMES.includes(key)) ||
        FIELD_NAMES.some((key) => data.fields[key] !== body.fields[key]) || !Array.isArray(data.missingFields)) return null;
    const missing = FIELD_NAMES.filter((key) => !data.fields[key]);
    if (missing.length !== data.missingFields.length || missing.some((key) => !data.missingFields.includes(key))) return null;
    return { id: data.id.toLowerCase(), status: 'draft', rawText: data.rawText, fields: copy(data.fields), missingFields: missing };
  }
  if (operation === 'confirmDraft') {
    if (data.id !== params.id || data.status !== 'active' || !object(data.fields) ||
        FIELD_NAMES.some((key) => data.fields[key] !== body.fields[key])) return null;
    return { id: data.id, status: 'active', fields: inputFields(data.fields) };
  }
  if (operation === 'command') return data.id === params.id && data.command === body.type && data.automaticEscalation === false ?
    { id: data.id, command: data.command, automaticEscalation: false } : null;
  if (operation === 'sos') return uuid(data.id) && data.tripId === params.id && data.status === 'active' && data.groupCapability === 'unavailable' ?
    { id: data.id.toLowerCase(), tripId: data.tripId, status: 'active', groupCapability: 'unavailable' } : null;
  if (operation === 'readTrip') {
    if (data.id !== params.id || data.driver_id !== actorId || !uuid(data.truck_id) ||
        !['active', 'arrived', 'cancelled'].includes(data.status) ||
        ['paused', 'map_active', 'checkins_active'].some((key) => typeof data[key] !== 'boolean') ||
        !Number.isSafeInteger(data.version) || data.version < 1) return null;
    const keys = ['id', 'truck_id', 'status', 'paused', 'map_active', 'checkins_active', 'version',
      'origin', 'destination', 'country', 'locale', 'time_zone', 'created_at', 'closed_at'];
    return Object.fromEntries(keys.map((key) => [key, data[key] ?? null]));
  }
  if (operation === 'readSnapshot') {
    if (data.tripId !== params.id || !instant(data.readAt) ||
        !['fresh', 'stale', 'unavailable'].includes(data.freshness) ||
        !(data.ageMs === null || (Number.isFinite(data.ageMs) && data.ageMs >= 0))) return null;
    const location = data.location;
    if (location !== null && (!object(location) || !instant(location.capturedAt) || !instant(location.receivedAt) ||
        !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
        !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180 ||
        !Number.isFinite(location.accuracy) || location.accuracy < 0)) return null;
    return { tripId: data.tripId, location: location === null ? null : {
      capturedAt: location.capturedAt, receivedAt: location.receivedAt, latitude: location.latitude,
      longitude: location.longitude, accuracy: location.accuracy },
    freshness: data.freshness, ageMs: data.ageMs, readAt: data.readAt };
  }
  if (operation === 'readIncident') {
    if (data.id !== params.id || !uuid(data.tripId) || !['active', 'resolved'].includes(data.status) ||
        !instant(data.createdAt) || !(data.resolvedAt === null || instant(data.resolvedAt)) || data.groupCapability !== 'unavailable') return null;
    return { id: data.id, tripId: data.tripId, status: data.status, createdAt: data.createdAt,
      resolvedAt: data.resolvedAt, groupCapability: 'unavailable' };
  }
  return null;
}
