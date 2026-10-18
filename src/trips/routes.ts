import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { type DraftFields, owner, problem } from '../contracts.js';
import { transaction, withTripTransaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { fieldsSchema, idParams, object, text, uuid } from '../api/schemas.js';
const requiredFields = ['truckId', 'origin', 'destination', 'country', 'locale', 'timeZone'] as const;
function missingFields(fields: DraftFields) { return requiredFields.filter(key => !fields[key]); }
function validateRegionalFields(fields: DraftFields) {
  try {
    // Store the canonical form: channel qualification matches locales exactly ('pt-br' would disable every channel).
    if (fields.locale) fields.locale = Intl.getCanonicalLocales(fields.locale)[0]!;
    if (fields.timeZone) new Intl.DateTimeFormat('en', { timeZone: fields.timeZone });
  } catch { problem(400, 'invalid_locale_or_time_zone'); }
}
export function tripRoutes(app: FastifyInstance, ctx: Context) {
  app.post('/v1/trucks', { schema: { body: object({ label: text }) } }, request => transaction(ctx.pool, client => idempotent(ctx, client, request, async () => {
    const id = randomUUID(); await client.query('INSERT INTO trucks VALUES($1,$2,$3)', [id, request.actor.id, (request.body as { label: string }).label]); return { id };
  })));
  app.post('/v1/trip-drafts', { schema: { body: object({ text: { type: 'string', minLength: 1, maxLength: 10000 }, fields: fieldsSchema, audio: { type: 'string', maxLength: 1000 } }, []) } }, request => transaction(ctx.pool, client => idempotent(ctx, client, request, async () => {
    const body = request.body as { text?: string; fields?: DraftFields; audio?: string };
    if (body.audio !== undefined) problem(422, 'unsupported_audio');
    if (!body.text?.trim()) problem(400, 'text_required');
    const fields = body.fields ?? {}; validateRegionalFields(fields);
    if (fields.truckId && !(await client.query('SELECT id FROM trucks WHERE id=$1 AND driver_id=$2', [fields.truckId, request.actor.id])).rowCount) problem(403, 'truck_not_owned');
    const id = randomUUID(); await client.query('INSERT INTO trip_drafts VALUES($1,$2,$3,$4,$5)', [id, request.actor.id, body.text, fields, ctx.clock()]);
    return { id, rawText: body.text, fields, missingFields: missingFields(fields), status: 'draft' };
  })));
  app.post('/v1/trip-drafts/:id/confirm', { schema: { params: idParams, body: object({ confirmed: { const: true }, contactGrantIds: { type: 'array', maxItems: 10, uniqueItems: true, items: uuid }, fields: fieldsSchema }, ['confirmed', 'contactGrantIds']) } }, request => transaction(ctx.pool, async client => {
    const id = (request.params as { id: string }).id;
    const draft = (await client.query('SELECT * FROM trip_drafts WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!draft) problem(404, 'draft_not_found'); if (draft.driver_id !== request.actor.id) problem(403, 'forbidden');
    return idempotent(ctx, client, request, async () => {
      const body = request.body as { fields?: DraftFields; contactGrantIds: string[] };
      const grantIds = body.contactGrantIds.map(id => id.toLowerCase()).toSorted();
      if (new Set(grantIds).size !== grantIds.length) problem(400, 'duplicate_contact_grants');
      const fields: DraftFields = { ...draft.fields, ...body.fields }; validateRegionalFields(fields);
      if (missingFields(fields).length) problem(409, 'draft_incomplete');
      const already = (await client.query('SELECT id FROM trips WHERE id=$1', [id])).rows[0];
      if (already) problem(409, 'draft_already_confirmed');
      if (!(await client.query('SELECT id FROM trucks WHERE id=$1 AND driver_id=$2', [fields.truckId, request.actor.id])).rowCount) problem(403, 'truck_not_owned');
      for (const grant of grantIds) {
        const row = (await client.query('SELECT * FROM contact_grants WHERE id=$1 AND driver_id=$2 FOR NO KEY UPDATE', [grant, request.actor.id])).rows[0];
        if (!row?.accepted_at || row.revoked_at || (!row.map_accepted && !row.incident_accepted)) problem(409, 'contact_not_accepted');
      }
      await client.query('UPDATE trip_drafts SET fields=$2 WHERE id=$1', [id, fields]);
      await client.query(`INSERT INTO trips(id,driver_id,truck_id,origin,destination,country,locale,time_zone,created_at,expected_arrival_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, request.actor.id, fields.truckId, fields.origin, fields.destination, fields.country, fields.locale, fields.timeZone, ctx.clock(), fields.expectedArrivalAt ?? null]);
      for (const grant of grantIds) await client.query('INSERT INTO trip_grants(trip_id,grant_id) VALUES($1,$2)', [id, grant]);
      return { id, status: 'active', fields };
    });
  }));
  app.get('/v1/trips/:id', { schema: { params: idParams } }, request => withTripTransaction(ctx, (request.params as { id: string }).id, async (_client, trip) => { owner(trip, request.actor); return trip; }));
  app.post('/v1/trips/:id/commands', { schema: { params: idParams, body: object({ type: { enum: ['arrived', 'cancel', 'pause', 'resume', 'checkin_ok', 'rest_report'] } }) } }, request => withTripTransaction(ctx, (request.params as { id: string }).id, async (client, trip) => {
    owner(trip, request.actor);
    return idempotent(ctx, client, request, async () => {
      const type = (request.body as { type: string }).type;
      if (trip.status !== 'active') problem(409, 'trip_closed');
      if (type === 'arrived' || type === 'cancel') {
        await client.query(`UPDATE trips SET status=$2,map_active=false,checkins_active=false,closed_at=$3,version=version+1 WHERE id=$1`, [trip.id, type === 'arrived' ? 'arrived' : 'cancelled', ctx.clock()]);
        await client.query(`UPDATE jobs SET status='cancelled',cancelled_at=$2,version=version+1 WHERE trip_id=$1 AND class='ordinary' AND status IN ('pending','claimed')`, [trip.id, ctx.clock()]);
      } else if (type === 'pause' || type === 'resume') {
        await client.query('UPDATE trips SET paused=$2,checkins_active=$3,version=version+1 WHERE id=$1', [trip.id, type === 'pause', type === 'resume']);
        if (type === 'pause') await client.query(`UPDATE jobs SET status='cancelled',cancelled_at=$2,version=version+1 WHERE trip_id=$1 AND class='ordinary' AND status IN ('pending','claimed')`, [trip.id, ctx.clock()]);
      }
      const closing = type === 'checkin_ok' ? 'ok' : ['arrived', 'cancel', 'pause'].includes(type) ? 'cancelled' : null;
      if (closing) await client.query("UPDATE security_checks SET status=$2,closed_at=$3 WHERE trip_id=$1 AND status='asking'", [trip.id, closing, ctx.clock()]);
      await client.query('INSERT INTO trip_events VALUES($1,$2,$3,$4,$5)', [randomUUID(), trip.id, request.actor.id, type, ctx.clock()]);
      return { id: trip.id, command: type, automaticEscalation: false };
    });
  }));
}
