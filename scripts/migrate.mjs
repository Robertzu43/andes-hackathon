import { createContext, migrate } from '../dist/db.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const ctx = createContext(process.env.DATABASE_URL);
try { await migrate(ctx.pool); console.log('Migrations applied'); }
catch { process.stderr.write('Migration failed\n'); process.exitCode = 1; }
finally { await ctx.close(); }
