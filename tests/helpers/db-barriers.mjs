import assert from 'node:assert/strict';

export async function waitForBlockedQueries(pool, queryPattern, count) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await pool.query(`SELECT count(*)::integer AS count FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND query LIKE $1 AND wait_event_type='Lock'
        AND application_name=current_setting('application_name')`, [queryPattern]); // this test's schema only, not parallel files
    if (result.rows[0].count >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Expected ${count} blocked database queries matching ${queryPattern}`);
}
