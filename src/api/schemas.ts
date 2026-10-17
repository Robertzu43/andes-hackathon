export const uuid = { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' };
export const text = { type: 'string', minLength: 1, maxLength: 300, pattern: '\\S' };
export const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
export const idParams = object({ id: uuid });
export const empty = object({});
export const scopeChoices = { map: { type: 'boolean' }, incident: { type: 'boolean' } };
export const fieldsSchema = object({ truckId: uuid, origin: text, destination: text, country: { type: 'string', pattern: '^[A-Z]{2}$' }, locale: { type: 'string', minLength: 2, maxLength: 40 }, timeZone: { type: 'string', minLength: 1, maxLength: 80 } }, []);
