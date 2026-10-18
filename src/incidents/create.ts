import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ChannelSupport, CheckReason, Trip } from '../contracts.js';
const channelsByRole = { family: ['sms', 'whatsapp', 'voice'], colleague: ['sms', 'whatsapp'] } as const;
/** SQL-only, inside the caller's trip transaction: incident, per-recipient/channel jobs and outbox commit together. */
export async function createIncident(client: pg.PoolClient, trip: Trip, trigger: 'sos' | 'missed_check', checkReason: CheckReason | null, support: ChannelSupport[], now: Date): Promise<string> {
  const id = randomUUID();
  await client.query('INSERT INTO incidents(id,trip_id,driver_id,created_at,trigger,check_reason) VALUES($1,$2,$3,$4,$5,$6)', [id, trip.id, trip.driver_id, now, trigger, checkReason]);
  const grants = (await client.query(`SELECT cg.id,cg.contact_id,cg.phone,cg.role,i.phone AS verified_phone,i.phone_verified FROM trip_grants tg JOIN contact_grants cg ON cg.id=tg.grant_id JOIN identities i ON i.id=cg.contact_id WHERE tg.trip_id=$1 AND tg.revoked_at IS NULL AND cg.accepted_at IS NOT NULL AND cg.revoked_at IS NULL AND cg.incident_accepted`, [trip.id])).rows;
  for (const grant of grants) for (const channel of channelsByRole[grant.role as keyof typeof channelsByRole]) {
    const enabled = support.some(s => s.channel === channel && s.country === trip.country && s.locale === trip.locale);
    const reason = !grant.phone_verified || grant.phone !== grant.verified_phone ? 'verified_phone_mismatch' : !enabled ? 'country_channel_locale_unqualified' : null;
    const jobId = randomUUID();
    // shortcut: 15-minute synthetic dispatch lifetime; qualify channel deadlines before live enablement.
    await client.query(`INSERT INTO jobs(id,trip_id,incident_id,grant_id,recipient_id,channel,class,status,unavailable_reason,created_at,due_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,'emergency',$7,$8,$9,$9,$10)`,
      [jobId, trip.id, id, grant.id, grant.contact_id, channel, reason ? 'unavailable' : 'pending', reason, now, new Date(now.getTime() + 900000)]);
    if (!reason) await client.query('INSERT INTO outbox(id,job_id,job_version,class,created_at,next_publish_at) VALUES($1,$2,1,\'emergency\',$3,$3)', [randomUUID(), jobId, now]);
  }
  await client.query(`INSERT INTO jobs(id,trip_id,incident_id,channel,class,status,unavailable_reason,created_at,due_at) VALUES($1,$2,$3,'group','emergency','unavailable','group_support_unverified',$4,$4)`, [randomUUID(), trip.id, id, now]);
  return id;
}
