import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=pathToFileURL(resolve(process.env.Q48_REVIEW_CANDIDATE)+sep);
const {fixture}=await import(new URL('tests/helpers/runtime.mjs',root));
const {checkOnce}=await import(new URL('dist/checks/sweep.js',root));
const config={silenceMs:120000,askGraceMs:60000,arrivalGraceMs:120000,sweepMs:5000};

for(const wallDelayMs of [0,1001]) {
  test(`real SQL lock wait preserves the opening grace: ${wallDelayMs}ms control`,{timeout:15000},async t=>{
    const f=await fixture(t); const trip=await f.trip(); f.advance(config.silenceMs+1);
    const connection=await f.ctx.pool.connect(); let opening; let measuredWallMs=0; let applicationElapsedMs=0;
    try {
      await connection.query('BEGIN'); await connection.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE',[trip]);
      opening=checkOnce(f.ctx,[],config);
      const deadline=performance.now()+2500; let observed=false;
      while(performance.now()<deadline) {
        const result=await f.ctx.pool.query(`SELECT count(*)::int n FROM pg_stat_activity
          WHERE datname=current_database() AND query LIKE 'SELECT * FROM trips WHERE id=$1 FOR UPDATE%'
          AND pid<>pg_backend_pid() AND wait_event_type='Lock'`);
        if(result.rows[0].n) { observed=true;break; }
        await delay(10);
      }
      assert.ok(observed,'the runtime must actually block on the real SQL row');
      const start=performance.now();
      if(wallDelayMs) await delay(wallDelayMs);
      measuredWallMs=performance.now()-start;
      applicationElapsedMs=wallDelayMs?Math.max(wallDelayMs,Math.floor(measuredWallMs)):0;
      f.advance(applicationElapsedMs);
    } finally { await connection.query('ROLLBACK'); connection.release(); }
    await opening;
    const row=(await f.ctx.pool.query('SELECT created_at,ask_until FROM security_checks WHERE trip_id=$1',[trip])).rows[0];
    assert.ok(row);
    const remaining=row.ask_until.getTime()-f.ctx.clock().getTime();
    t.diagnostic(JSON.stringify({wallDelayMs,measuredWallMs,applicationElapsedMs,remainingGraceMs:remaining,createdAt:row.created_at,askUntil:row.ask_until}));
    if(wallDelayMs) assert.ok(measuredWallMs>=1000,'must exercise at least one second of actual lock wait');
    assert.equal(remaining,config.askGraceMs,'row-lock delay must not consume a new check response window');
  });
}
