import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { problem } from '../contracts.js';
import { transaction, withTripTransaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { empty, idParams, object, scopeChoices, uuid } from '../api/schemas.js';
export function contactRoutes(app: FastifyInstance, ctx: Context) {
  app.post('/v1/contacts', { schema: { body: object({ contactId: uuid, phone: { type: 'string', pattern: '^\\+[1-9]\\d{6,14}$' }, ...scopeChoices }) } }, request => transaction(ctx.pool, client => idempotent(ctx, client, request, async () => {
    const body = request.body as { contactId: string; phone: string; map: boolean; incident: boolean };
    if ((!body.map && !body.incident) || body.contactId === request.actor.id) problem(400, 'invalid_consent_request');
    if (!(await client.query('SELECT id FROM identities WHERE id=$1', [body.contactId])).rowCount) problem(404, 'contact_not_found');
    const id = randomUUID();
    const inserted = await client.query(`INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(driver_id,contact_id) DO NOTHING`, [id, request.actor.id, body.contactId, body.phone, body.map, body.incident]);
    if (!inserted.rowCount) problem(409, 'contact_already_invited');
    return { id, status: 'pending' };
  })));
  app.post('/v1/contacts/:id/accept', { schema: { params: idParams, body: object(scopeChoices) } }, request => transaction(ctx.pool, async client => {
    const id = (request.params as { id: string }).id;
    const grant = (await client.query('SELECT * FROM contact_grants WHERE id=$1 FOR NO KEY UPDATE', [id])).rows[0];
    if (!grant) problem(404, 'grant_not_found'); if (grant.contact_id !== request.actor.id) problem(403, 'forbidden');
    return idempotent(ctx, client, request, async () => {
      const body = request.body as { map: boolean; incident: boolean };
      if (!request.actor.phoneVerified || request.actor.phone !== grant.phone) problem(409, 'verified_phone_mismatch');
      if ((!body.map && !body.incident) || (body.map && !grant.map_requested) || (body.incident && !grant.incident_requested)) problem(400, 'invalid_consent_scope');
      if (grant.revoked_at) problem(409, 'consent_revoked');
      if (grant.accepted_at) problem(409, 'already_accepted');
      await client.query('UPDATE contact_grants SET map_accepted=$2,incident_accepted=$3,accepted_at=$4 WHERE id=$1', [id, body.map, body.incident, ctx.clock()]);
      return { id, map: body.map, incident: body.incident, status: 'accepted' };
    });
  }));
  app.post('/v1/contacts/:id/revoke', { schema: { params: idParams, body: empty } }, request => transaction(ctx.pool, async client => {
    const id = (request.params as { id: string }).id;
    const grant = (await client.query('SELECT * FROM contact_grants WHERE id=$1 FOR NO KEY UPDATE', [id])).rows[0];
    if (!grant) problem(404, 'grant_not_found');
    if (grant.driver_id !== request.actor.id && grant.contact_id !== request.actor.id) problem(403, 'forbidden');
    return idempotent(ctx, client, request, async () => {
      // Stable grant keys need NO KEY UPDATE: SOS inserts take implicit FK KEY SHARE under their trip lock.
      await client.query('SELECT t.id FROM trips t JOIN trip_grants tg ON tg.trip_id=t.id WHERE tg.grant_id=$1 ORDER BY t.id FOR UPDATE OF t', [id]);
      await client.query('UPDATE contact_grants SET revoked_at=COALESCE(revoked_at,$2),revoked_by=COALESCE(revoked_by,$3) WHERE id=$1', [id, ctx.clock(), request.actor.id]);
      await client.query('UPDATE trip_grants SET revoked_at=COALESCE(revoked_at,$2),revoked_by=COALESCE(revoked_by,$3) WHERE grant_id=$1', [id, ctx.clock(), request.actor.id]);
      await client.query("UPDATE jobs SET status='cancelled',cancelled_at=$2,version=version+1 WHERE grant_id=$1 AND status IN ('pending','claimed')", [id, ctx.clock()]);
      return { id, revoked: true };
    });
  }));
  app.post('/v1/trips/:id/contacts/:grantId/revoke', { schema: { params: object({ id: uuid, grantId: uuid }), body: empty } }, request => {
    const { id, grantId } = request.params as { id: string; grantId: string };
    return withTripTransaction(ctx, id, async (client, trip) => {
      const grant = (await client.query(`SELECT cg.contact_id FROM trip_grants tg JOIN contact_grants cg ON cg.id=tg.grant_id WHERE tg.trip_id=$1 AND tg.grant_id=$2`, [id, grantId])).rows[0];
      if (!grant) problem(404, 'grant_not_found');
      if (trip.driver_id !== request.actor.id && grant.contact_id !== request.actor.id) problem(403, 'forbidden');
      return idempotent(ctx, client, request, async () => {
        await client.query('UPDATE trip_grants SET revoked_at=COALESCE(revoked_at,$3),revoked_by=COALESCE(revoked_by,$4) WHERE trip_id=$1 AND grant_id=$2', [id, grantId, ctx.clock(), request.actor.id]);
        await client.query(`UPDATE jobs SET status='cancelled',cancelled_at=$3,version=version+1 WHERE trip_id=$1 AND grant_id=$2 AND status IN ('pending','claimed')`, [id, grantId, ctx.clock()]);
        return { id: grantId, tripId: id, revoked: true };
      });
    });
  });
}
