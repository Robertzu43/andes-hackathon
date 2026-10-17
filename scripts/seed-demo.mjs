import { randomUUID } from 'node:crypto';
import { createContext, databaseConfig, transaction } from '../dist/db.js';
// Synthetic demo reports on the Panamericana Sur, flagged synthetic so every view can label them as demo data.
if (process.env.SEED_DEMO !== '1') { process.stderr.write('Set SEED_DEMO=1 to insert synthetic demo reports\n'); process.exit(1); }
const clusters = [
  { lat: -12.325, lon: -76.775, night: 12, day: 4 }, // Lurín / Punta Hermosa
  { lat: -12.525, lon: -76.725, night: 9, day: 3 }, // Chilca
  { lat: -13.075, lon: -76.375, night: 7, day: 3 }, // Cañete
  { lat: -12.175, lon: -76.975, night: 1, day: 0 }, // single reports stay below the suppression count
  { lat: -12.725, lon: -76.625, night: 0, day: 1 },
];
const now = Date.now(); const rows = [];
for (const c of clusters) for (let i = 0; i < c.night + c.day; i++) {
  const at = new Date(now - (i * 3 + 1) * 86400000);
  at.setUTCHours(i < c.night ? 4 + (i % 3) : 19, 30 * (i % 2), 0, 0); // 23:00–01:30 or 14:00–14:30 in Lima
  rows.push([i % 4 === 3 ? 'intento_robo' : 'robo', c.lat + ((i % 5) - 2) * 0.004, c.lon + ((i % 3) - 1) * 0.004, at]);
}
let ctx;
try {
  ctx = createContext(databaseConfig(), undefined, 2);
  await transaction(ctx.pool, async client => {
    const seeder = (await client.query(`INSERT INTO identities(id,issuer,subject) VALUES($1,'seed','demo') ON CONFLICT(issuer,subject) DO UPDATE SET subject=excluded.subject RETURNING id`, [randomUUID()])).rows[0].id;
    await client.query('DELETE FROM reports WHERE reporter_id=$1 AND synthetic', [seeder]);
    for (const [kind, lat, lon, at] of rows) await client.query('INSERT INTO reports(id,reporter_id,kind,latitude,longitude,occurred_at,created_at,synthetic) VALUES($1,$2,$3,$4,$5,$6,now(),true)', [randomUUID(), seeder, kind, lat, lon, at]);
  });
  console.log(`Seeded ${rows.length} synthetic reports`);
} catch { process.stderr.write('Seed failed\n'); process.exitCode = 1; }
finally { await ctx?.close(); }
