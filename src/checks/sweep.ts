import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ChannelSupport, Trip } from '../contracts.js';
import { withTripTransaction, type Context } from '../db.js';
import { createIncident } from '../incidents/create.js';
export interface CheckConfig { silenceMs: number; askGraceMs: number; arrivalGraceMs: number; sweepMs: number }
/** Demo timings, not evidence-backed safety thresholds: automatic checks stay off unless all four are set. */
export function checkConfig(env: NodeJS.ProcessEnv): CheckConfig | null {
  const raw = [env.SILENCE_MS, env.ASK_GRACE_MS, env.ARRIVAL_GRACE_MS, env.CHECK_SWEEP_MS];
  if (raw.every(value => value === undefined)) return null;
  const [silenceMs, askGraceMs, arrivalGraceMs, sweepMs] = raw.map(Number) as [number, number, number, number];
  if ([silenceMs, askGraceMs, arrivalGraceMs, sweepMs].some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('Complete check timing configuration required');
  return { silenceMs, askGraceMs, arrivalGraceMs, sweepMs };
}
/** Trips that should open a check now. Sign of life: location receipt, OK/resume command, incident resolution, or trip start. */
async function dueReasons(db: pg.Pool | pg.PoolClient, now: Date, config: CheckConfig, tripId: string | null = null) {
  return (await db.query(`WITH s AS (
      SELECT t.id, t.sharing_stopped_at, t.expected_arrival_at, greatest(t.created_at, l.received_at, e.signal_at, r.resolved_at) AS signal_at,
        greatest(t.created_at, e.signal_at, r.resolved_at) AS driver_at
      FROM trips t LEFT JOIN latest_locations l ON l.trip_id=t.id
      LEFT JOIN LATERAL (SELECT max(created_at) FILTER (WHERE kind IN ('checkin_ok','resume')) AS signal_at
        FROM trip_events WHERE trip_id=t.id) e ON true
      LEFT JOIN LATERAL (SELECT max(resolved_at) AS resolved_at FROM incidents WHERE trip_id=t.id) r ON true
      WHERE t.status='active' AND t.checkins_active AND NOT t.paused AND ($3::uuid IS NULL OR t.id=$3)
        AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.trip_id=t.id AND i.status='active')
        AND NOT EXISTS (SELECT 1 FROM security_checks c WHERE c.trip_id=t.id AND c.status='asking'))
    SELECT id, signal_at, CASE
      WHEN sharing_stopped_at > signal_at THEN 'sharing_stopped'
      WHEN signal_at < $1 THEN 'silence'
      -- Overdue counts from the later of the expected arrival and the driver's last action (start, OK, resume, resolution).
      WHEN expected_arrival_at IS NOT NULL AND greatest(expected_arrival_at, driver_at) < $2 THEN 'arrival_overdue' END AS reason
    FROM s`, [new Date(now.getTime() - config.silenceMs), new Date(now.getTime() - config.arrivalGraceMs), tripId])).rows.filter(row => row.reason);
}
async function sweepTrip(client: pg.PoolClient, trip: Trip, now: Date, config: CheckConfig, support: ChannelSupport[]) {
  const check = (await client.query("SELECT * FROM security_checks WHERE trip_id=$1 AND status='asking' FOR UPDATE", [trip.id])).rows[0];
  if (check) {
    if (check.ask_until > now) return;
    // Commands already cancel open checks on close/pause; this guards any other path.
    if (trip.status !== 'active' || trip.paused) { await client.query("UPDATE security_checks SET status='cancelled',closed_at=$2 WHERE id=$1", [check.id, now]); return; }
    const active = (await client.query("SELECT id FROM incidents WHERE trip_id=$1 AND status='active'", [trip.id])).rows[0];
    const incidentId = active?.id ?? await createIncident(client, trip, 'missed_check', check.reason, support, now);
    await client.query("UPDATE security_checks SET status='escalated',incident_id=$2,closed_at=$3 WHERE id=$1", [check.id, incidentId, now]);
    return;
  }
  const [due] = await dueReasons(client, now, config, trip.id);
  if (due) await client.query("INSERT INTO security_checks(id,trip_id,reason,status,signal_at,created_at,ask_until) VALUES($1,$2,$3,'asking',$4,$5,$6)",
    [randomUUID(), trip.id, due.reason, due.signal_at, now, new Date(now.getTime() + config.askGraceMs)]);
}
/** SQL-only: each trip in its own short transaction, so one failure or a restart never loses or duplicates work. */
export async function checkOnce(ctx: Context, support: ChannelSupport[], config: CheckConfig): Promise<void> {
  const now = ctx.clock();
  // ponytail: scans every active trip each sweep; add a due-time index when trips reach the thousands.
  const expired = (await ctx.pool.query("SELECT trip_id FROM security_checks WHERE status='asking' AND ask_until<=$1", [now])).rows.map(row => row.trip_id as string);
  const opening = (await dueReasons(ctx.pool, now, config)).map(row => row.id as string);
  for (const tripId of new Set([...expired, ...opening])) {
    // Read the clock under the trip lock: a stale pre-wait time would shorten the grace window or open an expired check.
    try { await withTripTransaction(ctx, tripId, (client, trip) => sweepTrip(client, trip, ctx.clock(), config, support)); }
    catch { process.stderr.write('Security check failed for one trip\n'); }
  }
}
