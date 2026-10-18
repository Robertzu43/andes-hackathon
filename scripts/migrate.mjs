import { createContext, databaseConfig, migrate } from '../dist/db.js';
const ctx = createContext(databaseConfig(), undefined, 2);
try { await migrate(ctx.pool); console.log('Migrations applied'); }
catch { process.stderr.write('Migration failed\n'); process.exitCode = 1; }
finally { await ctx.close(); }
