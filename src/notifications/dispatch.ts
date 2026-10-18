import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type pg from 'pg';
import { transaction, withTripTransaction, type Context } from '../db.js';
import type { Channel, Job, Trip } from '../contracts.js';
import type { CallbackEvent, Outcome, Payload, Provider } from './zavu.js';
import { alertSummary } from './wording.js';
export type WorkClass = 'emergency' | 'ordinary';
export interface Envelope { jobId: string; version: number; class: WorkClass }
export interface Delivery { body: Envelope; receipt: string }
export interface Transport {
  publish(body: Envelope, signal?: AbortSignal): Promise<void>;
  receive(kind: WorkClass, signal: AbortSignal): Promise<Delivery[]>;
  ack(kind: WorkClass, receipt: string, signal?: AbortSignal): Promise<void>;
  defer(kind: WorkClass, receipt: string, signal?: AbortSignal): Promise<void>;
}
export interface Claim { jobId: string; tripId: string; token: string; owner: string; version: number }
export interface Attempt extends pg.QueryResultRow {
  id: string; job_id: string; job_version: number; project_id: string; sender_id: string;
  channel: Channel; payload: Payload; state: string; provider_message_id: string | null;
  destination_hash: string; delivery_status: string | null;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const after = (now: Date, ms: number) => new Date(now.getTime() + ms);
function envelope(value: Envelope | (Omit<Envelope, 'jobId'> & { id: string })): Envelope {
  return { jobId: 'jobId' in value ? value.jobId : value.id, version: value.version, class: value.class };
}
export async function relayOnce(ctx: Context, transport: Pick<Transport, 'publish'>, owner: string, signal?: AbortSignal): Promise<boolean> {
  const now = ctx.clock(); const token = `${owner}:${randomUUID()}`;
  const row = await transaction(ctx.pool, async client => (await client.query(`UPDATE outbox SET lease_owner=$2,lease_until=$3,publish_attempts=publish_attempts+1
    WHERE id=(SELECT o.id FROM outbox o JOIN jobs j ON j.id=o.job_id WHERE o.published_at IS NULL AND o.next_publish_at<=$1
      AND (o.lease_until IS NULL OR o.lease_until<=$1) AND j.version=o.job_version AND j.status IN ('pending','claimed') AND j.due_at<=$1
      AND (j.expires_at IS NULL OR j.expires_at>$1) ORDER BY o.next_publish_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1)
    RETURNING *`, [now, token, after(now, 30000)])).rows[0]);
  if (!row) return false;
  try {
    await transport.publish({ jobId: row.job_id, version: row.job_version, class: row.class }, signal);
    await ctx.pool.query('UPDATE outbox SET published_at=$3,lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND lease_until>$3', [row.id, token, ctx.clock()]);
  } catch {
    const backoff = Math.min(300000, 1000 * 2 ** Math.min(row.publish_attempts, 8));
    await ctx.pool.query('UPDATE outbox SET lease_owner=NULL,lease_until=NULL,next_publish_at=$3 WHERE id=$1 AND lease_owner=$2', [row.id, token, after(ctx.clock(), backoff)]);
  }
  return true;
}
export async function claimJob(ctx: Context, input: Envelope, owner: string): Promise<Claim | null> {
  const message = envelope(input); const now = ctx.clock();
  const found = (await ctx.pool.query('SELECT trip_id FROM jobs WHERE id=$1', [message.jobId])).rows[0];
  if (!found) return null;
  return withTripTransaction(ctx, found.trip_id, async client => {
    const job = (await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [message.jobId])).rows[0];
    if (!job || job.version !== message.version || job.class !== message.class || job.due_at > now || (job.expires_at && job.expires_at <= now) || !['pending', 'claimed'].includes(job.status) || (job.status === 'claimed' && job.claim_until > now)) return null;
    if ((await client.query('SELECT 1 FROM dispatch_attempts WHERE job_id=$1', [job.id])).rowCount) return null;
    const token = randomUUID();
    await client.query("UPDATE jobs SET status='claimed',claim_token=$2,claim_owner=$3,claim_until=$4 WHERE id=$1", [job.id, token, owner, after(now, 30000)]);
    return { jobId: job.id, tripId: job.trip_id, token, owner, version: job.version };
  });
}
async function invalidate(client: pg.PoolClient, job: Job, now: Date, reason: string) {
  await client.query("UPDATE jobs SET status='cancelled',cancelled_at=$2,version=version+1,unavailable_reason=$3 WHERE id=$1 AND status='claimed'", [job.id, now, reason]);
}
export async function authorizeJob(ctx: Context, claim: Claim | null, provider: Provider): Promise<Attempt | null> {
  if (!claim) return null;
  return withTripTransaction(ctx, claim.tripId, async (client, trip) => {
    const now = ctx.clock();
    const job = (await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [claim.jobId])).rows[0];
    if (!job || job.version !== claim.version || job.status !== 'claimed' || job.claim_token !== claim.token || job.claim_owner !== claim.owner || job.claim_until <= now) return null;
    const q = provider.qualification;
    const grant = (await client.query(`SELECT cg.*,tg.revoked_at AS trip_revoked_at,i.phone AS verified_phone,i.phone_verified
      FROM trip_grants tg JOIN contact_grants cg ON cg.id=tg.grant_id JOIN identities i ON i.id=cg.contact_id
      WHERE tg.trip_id=$1 AND tg.grant_id=$2`, [trip.id, job.grant_id])).rows[0];
    const incident = job.incident_id ? (await client.query('SELECT * FROM incidents WHERE id=$1 AND trip_id=$2', [job.incident_id, trip.id])).rows[0] : null;
    const eligible = grant && grant.driver_id === trip.driver_id && grant.contact_id === job.recipient_id && grant.accepted_at && !grant.revoked_at && !grant.trip_revoked_at && grant.incident_accepted && grant.phone_verified && grant.phone === grant.verified_phone;
    if (!eligible || (job.expires_at && job.expires_at <= now) || (job.class === 'emergency' ? !incident || incident.status !== 'active' || incident.driver_id !== trip.driver_id : trip.status !== 'active' || !trip.checkins_active || trip.paused)) {
      await invalidate(client, job, now, 'authorization_no_longer_valid'); return null;
    }
    if (!q.live || !q.entries.some(e => e.channel === job.channel && e.country === trip.country && e.locale === trip.locale)) {
      await client.query("UPDATE jobs SET status='unavailable',unavailable_reason='country_channel_locale_unqualified' WHERE id=$1", [job.id]); return null;
    }
    if (q.allowedDestinations && !q.allowedDestinations.includes(grant.phone)) {
      await client.query("UPDATE jobs SET status='unavailable',unavailable_reason='destination_not_allowed' WHERE id=$1", [job.id]); return null;
    }
    // Account-row locking serializes reservations across channels and worker replicas.
    await client.query('INSERT INTO quota_accounts VALUES($1) ON CONFLICT DO NOTHING', [q.accountId]);
    await client.query('SELECT project_id FROM quota_accounts WHERE project_id=$1 FOR UPDATE', [q.accountId]);
    if (q.demoLimits) {
      // Under the account lock, so concurrent workers cannot overshoot. Per session = per recipient identity: each demo world has one consented persona.
      const used = (await client.query(`SELECT count(*) FILTER (WHERE j.incident_id=$1)::int AS incident,count(*) FILTER (WHERE j.recipient_id=$2)::int AS session
        FROM dispatch_attempts a JOIN jobs j ON j.id=a.job_id WHERE j.incident_id=$1 OR j.recipient_id=$2`, [job.incident_id, job.recipient_id])).rows[0];
      if (used.incident >= q.demoLimits.perIncident || used.session >= q.demoLimits.perSession) {
        await client.query("UPDATE jobs SET status='unavailable',unavailable_reason='demo_budget_exhausted' WHERE id=$1", [job.id]); return null;
      }
    }
    const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
    const counts = (await client.query(`SELECT count(*)::int AS daily,count(*) FILTER(WHERE channel=$3)::int AS channel FROM quota_reservations WHERE project_id=$1 AND reserved_at>=$2`, [q.accountId, day, job.channel])).rows[0];
    const requests = (await client.query('SELECT count(*)::int AS n FROM provider_requests WHERE project_id=$1 AND reserved_at>$2', [q.accountId, after(now, -60000)])).rows[0].n;
    const reserve = job.class === 'ordinary' ? q.emergencyReserve : 0;
    if (counts.daily >= q.dailyLimit - reserve || counts.channel >= q.channelDailyLimit - reserve || requests >= q.minuteLimit - reserve) {
      await client.query("UPDATE jobs SET status='pending',claim_token=NULL,claim_owner=NULL,claim_until=NULL,due_at=$2 WHERE id=$1", [job.id, after(now, 60000)]);
      return null;
    }
    const id = randomUUID();
    const location = trip.map_active && grant.map_accepted ? (await client.query('SELECT * FROM latest_locations WHERE trip_id=$1', [trip.id])).rows[0] : null;
    const truck = (await client.query('SELECT label FROM trucks WHERE id=$1', [trip.truck_id])).rows[0]!.label as string;
    const check = incident?.trigger === 'missed_check' ? (await client.query('SELECT signal_at FROM security_checks WHERE incident_id=$1 ORDER BY created_at LIMIT 1', [incident.id])).rows[0] : null;
    const summary = alertSummary({ truck, country: trip.country, timeZone: trip.time_zone, now, signalAt: check?.signal_at ?? null, incident: incident ?? null, location: location ?? null, voice: job.channel === 'voice' });
    const payload = provider.payload({ attemptId: id, to: grant.phone, channel: job.channel, country: trip.country, locale: trip.locale, summary });
    const attempt = (await client.query(`INSERT INTO dispatch_attempts(id,job_id,job_version,owner,claim_token,project_id,sender_id,channel,state,payload,payload_hash,destination_hash,authorized_at,next_reconcile_at,evidence_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'authorized',$9,$10,$11,$12,$13,$14) RETURNING *`, [id, job.id, job.version, claim.owner, claim.token, q.accountId, q.senderId, job.channel, payload, hash(JSON.stringify(payload)), hash(grant.phone), now, after(now, 30000), after(now, 86400000)])).rows[0] as Attempt;
    await client.query('INSERT INTO quota_reservations VALUES($1,$2,$3,$4,$5)', [id, q.accountId, job.channel, job.class, now]);
    await client.query("INSERT INTO provider_requests VALUES($1,$2,'send',$3)", [id, q.accountId, now]);
    await client.query("UPDATE jobs SET status='authorized' WHERE id=$1", [job.id]);
    return attempt;
  });
}
const ranks: Record<string, number> = { queued: 0, pending_url_verification: 0, sending: 1, sent: 2, delivered: 3, read: 4 };
async function deliveryFact(client: pg.PoolClient, attempt: Attempt, status: string) {
  if (attempt.channel === 'voice') return false;
  const old = attempt.delivery_status;
  if (status === 'failed' && old && (ranks[old] ?? -1) >= 3) return false;
  if (status !== 'failed' && !(status in ranks)) return false;
  if (old === 'failed' && (ranks[status] ?? -1) < 3) return false;
  if (old && old in ranks && status in ranks && ranks[status]! < ranks[old]!) return false;
  await client.query('UPDATE dispatch_attempts SET delivery_status=$2 WHERE id=$1', [attempt.id, status]);
  if (status === 'delivered' || status === 'read') {
    await client.query("UPDATE jobs SET status='delivered' WHERE id=$1 AND status IN ('authorized','unknown','accepted','delivered')", [attempt.job_id]);
    await client.query('UPDATE dispatch_attempts SET next_reconcile_at=NULL WHERE id=$1', [attempt.id]);
  }
  return true;
}
async function correlate(client: pg.PoolClient, attempt: Attempt) {
  const events = (await client.query("SELECT * FROM provider_events WHERE project_id=$1 AND message_id=$2 AND disposition='unmatched' ORDER BY received_at,event_id FOR UPDATE", [attempt.project_id, attempt.provider_message_id])).rows;
  for (const event of events) {
    let disposition = 'incompatible';
    if (event.sender_id === attempt.sender_id && event.channel === attempt.channel && event.destination_hash === attempt.destination_hash && event.type === `message.${event.status}`) {
      const current = (await client.query('SELECT * FROM dispatch_attempts WHERE id=$1', [attempt.id])).rows[0] as Attempt;
      // Exact voice playback/receipt semantics are unqualified: preserve evidence only.
      disposition = attempt.channel === 'voice' ? 'voice_semantics_unqualified' : await deliveryFact(client, current, event.status) ? 'applied' : 'contradictory_or_unknown';
    }
    await client.query('UPDATE provider_events SET disposition=$3,attempt_id=$4 WHERE project_id=$1 AND event_id=$2', [event.project_id, event.event_id, disposition, attempt.id]);
  }
}
export async function finishAttempt(ctx: Context, authorization: Attempt, result: Outcome): Promise<void> {
  await transaction(ctx.pool, async client => {
    // Response mapping and callback insert share a short SQL lock, never a provider call.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`provider:${authorization.project_id}`]);
    const attempt = (await client.query('SELECT * FROM dispatch_attempts WHERE id=$1 FOR UPDATE', [authorization.id])).rows[0] as Attempt | undefined;
    if (!attempt) return;
    const now = ctx.clock();
    if (result.state === 'accepted') {
      if (attempt.provider_message_id && attempt.provider_message_id !== result.messageId) return;
      const other = (await client.query('SELECT id FROM dispatch_attempts WHERE project_id=$1 AND provider_message_id=$2 AND id<>$3', [attempt.project_id, result.messageId, attempt.id])).rows[0];
      if (other) return;
      await client.query("UPDATE dispatch_attempts SET state='accepted',provider_message_id=$2,downstream_message_id=COALESCE($3,downstream_message_id),finished_at=COALESCE(finished_at,$4),next_reconcile_at=$5 WHERE id=$1", [attempt.id, result.messageId, result.providerMessageId ?? null, now, ['delivered', 'read'].includes(attempt.delivery_status ?? '') ? null : after(now, 60000)]);
      await client.query("UPDATE jobs SET status='accepted' WHERE id=$1 AND status IN ('authorized','unknown')", [attempt.job_id]);
      await deliveryFact(client, attempt, result.status);
      await correlate(client, { ...attempt, provider_message_id: result.messageId });
    } else if (['authorized', 'unknown'].includes(attempt.state) && !attempt.provider_message_id) {
      await client.query('UPDATE dispatch_attempts SET state=$2,rejection_code=$3,finished_at=$4,next_reconcile_at=$5 WHERE id=$1', [attempt.id, result.state, result.state === 'rejected' ? result.code : null, now, result.state === 'unknown' ? after(now, 300000) : null]);
      await client.query('UPDATE jobs SET status=$2 WHERE id=$1 AND status IN (\'authorized\',\'unknown\')', [attempt.job_id, result.state]);
    }
  });
}
export async function runJob(ctx: Context, message: Envelope, provider: Provider, owner: string, signal?: AbortSignal): Promise<void> {
  const claim = await claimJob(ctx, message, owner);
  const attempt = await authorizeJob(ctx, claim, provider);
  if (!attempt) return;
  let result: Outcome;
  try { result = await provider.send(attempt.payload, signal); } catch { result = { state: 'unknown' }; }
  await finishAttempt(ctx, attempt, result);
}
export async function saveCallback(ctx: Context, event: CallbackEvent, raw: Buffer): Promise<void> {
  await transaction(ctx.callbackPool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`provider:${event.projectId}`]);
    const now = ctx.clock();
    const inserted = await client.query(`INSERT INTO provider_events(project_id,event_id,sender_id,message_id,channel,destination_hash,type,status,error_code,dispatched_at,received_at,raw_hash,evidence_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`, [event.projectId, event.id, event.senderId, event.data.messageId, event.data.channel, hash(event.data.to), event.type, event.data.status, event.data.errorCode ?? null, new Date(event.timestamp), now, hash(raw), after(now, 604800000)]);
    if (!inserted.rowCount) return;
    const attempt = (await client.query('SELECT * FROM dispatch_attempts WHERE project_id=$1 AND provider_message_id=$2 FOR UPDATE', [event.projectId, event.data.messageId])).rows[0] as Attempt | undefined;
    if (attempt) await correlate(client, attempt);
  });
}
export async function recoverWork(ctx: Context): Promise<void> {
  const now = ctx.clock();
  await transaction(ctx.pool, async client => {
    // Never turn an authorized/unknown external attempt back into sendable work.
    await client.query("UPDATE dispatch_attempts SET state='unknown' WHERE state='authorized' AND authorized_at<=$1", [after(now, -30000)]);
    await client.query("UPDATE jobs j SET status='unknown' FROM dispatch_attempts a WHERE a.job_id=j.id AND a.state='unknown' AND j.status='authorized'");
    await client.query(`UPDATE jobs j SET status='pending',claim_token=NULL,claim_owner=NULL,claim_until=NULL
      WHERE j.status='claimed' AND j.claim_until<=$1 AND NOT EXISTS(SELECT 1 FROM dispatch_attempts a WHERE a.job_id=j.id)`, [now]);
    await client.query(`INSERT INTO outbox(id,job_id,job_version,class,created_at,next_publish_at)
      SELECT gen_random_uuid(),j.id,j.version,j.class,$1,$1 FROM jobs j WHERE j.status='pending' AND j.due_at<=$1 AND (j.expires_at IS NULL OR j.expires_at>$1)
      AND NOT EXISTS(SELECT 1 FROM dispatch_attempts a WHERE a.job_id=j.id) ON CONFLICT(job_id,job_version) DO NOTHING`, [now]);
    await client.query(`UPDATE outbox o SET published_at=NULL,next_publish_at=$1 FROM jobs j WHERE j.id=o.job_id AND j.version=o.job_version
      AND j.status='pending' AND j.due_at<=$1 AND o.published_at<=$2 AND (o.lease_until IS NULL OR o.lease_until<=$1)
      AND NOT EXISTS(SELECT 1 FROM dispatch_attempts a WHERE a.job_id=j.id)`, [now, after(now, -60000)]);
    // Retain minimal hashes/facts; discard sensitive immutable payload once recovery no longer needs it.
    await client.query('UPDATE dispatch_attempts SET payload=NULL WHERE payload IS NOT NULL AND evidence_expires_at<=$1', [now]);
    await client.query('DELETE FROM provider_events WHERE evidence_expires_at<=$1', [now]);
    await client.query('DELETE FROM quota_reservations WHERE reserved_at<$1', [after(now, -172800000)]);
    await client.query('DELETE FROM provider_requests WHERE reserved_at<$1', [after(now, -172800000)]);
  });
}
export async function reconcileOnce(ctx: Context, provider: Provider, signal?: AbortSignal, channel?: Channel): Promise<boolean> {
  const now = ctx.clock(); const token = randomUUID();
  const attempt = await transaction(ctx.pool, async client => (await client.query(`UPDATE dispatch_attempts SET reconcile_token=$2,reconcile_until=$3,reconcile_count=reconcile_count+1,next_reconcile_at=$4
    WHERE id=(SELECT id FROM dispatch_attempts WHERE project_id=$5 AND sender_id=$6 AND state IN ('authorized','unknown','accepted')
      AND ($7::text IS NULL OR channel=$7) AND next_reconcile_at<=$1 AND (reconcile_until IS NULL OR reconcile_until<=$1) ORDER BY next_reconcile_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [now, token, after(now, 30000), after(now, 300000), provider.qualification.accountId, provider.qualification.senderId, channel ?? null])).rows[0] as Attempt | undefined);
  if (!attempt) return false;
  // No documented lookup by idempotency key: no-ID attempts remain unknown, with no POST/list inference.
  if (attempt.provider_message_id) {
    const reserved = await transaction(ctx.pool, async client => {
      const q = provider.qualification;
      await client.query('SELECT project_id FROM quota_accounts WHERE project_id=$1 FOR UPDATE', [q.accountId]);
      const count = (await client.query('SELECT count(*)::int AS n FROM provider_requests WHERE project_id=$1 AND reserved_at>$2', [q.accountId, after(ctx.clock(), -60000)])).rows[0].n;
      if (count >= q.minuteLimit - q.emergencyReserve) return false;
      await client.query("INSERT INTO provider_requests VALUES($1,$2,'read',$3)", [randomUUID(), q.accountId, ctx.clock()]);
      return true;
    });
    if (!reserved) {
      await ctx.pool.query('UPDATE dispatch_attempts SET reconcile_token=NULL,reconcile_until=NULL WHERE id=$1 AND reconcile_token=$2', [attempt.id, token]);
      return true;
    }
    const result = await provider.read(attempt.provider_message_id, signal, { channel: attempt.channel, destinationHash: attempt.destination_hash }).catch(() => ({ state: 'unknown' as const }));
    if (result.state === 'accepted') await finishAttempt(ctx, attempt, result);
  }
  await ctx.pool.query('UPDATE dispatch_attempts SET reconcile_token=NULL,reconcile_until=NULL WHERE id=$1 AND reconcile_token=$2', [attempt.id, token]);
  return true;
}
export async function consume(ctx: Context, transport: Transport, provider: Provider, kind: WorkClass, limits: Record<Channel, number>, signal: AbortSignal): Promise<void> {
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > 16) throw new Error('Channel slots must be 1..16');
  const active: Record<Channel, Set<Promise<void>>> = { sms: new Set(), whatsapp: new Set(), voice: new Set() };
  try {
  while (!signal.aborted) {
    let messages: Delivery[];
    try { messages = await transport.receive(kind, signal); } catch { if (!signal.aborted) await delay(1000, undefined, { signal }).catch(() => {}); continue; }
    for (const message of messages) {
      if (signal.aborted) break;
      const job = (await ctx.pool.query('SELECT channel,class FROM jobs WHERE id=$1', [message.body.jobId ?? (message.body as unknown as { id: string }).id])).rows[0];
      if (!job || job.class !== kind || !['sms', 'whatsapp', 'voice'].includes(job.channel)) { await transport.ack(kind, message.receipt, signal); continue; }
      const channel = job.channel as Channel; const slots = active[channel];
      if (slots.size >= limits[channel]) { await transport.defer(kind, message.receipt, signal); continue; }
      const task = runJob(ctx, message.body, provider, randomUUID(), signal)
        .then(() => transport.ack(kind, message.receipt, signal)).catch(() => {})
        .finally(() => slots.delete(task));
      slots.add(task);
    }
  }
  } finally {
    await Promise.allSettled(Object.values(active).flatMap(slots => [...slots]));
  }
}
