import {createContext, databaseConfig} from '../dist/db.js';
import {bootstrap} from '../dist/bootstrap.js';
const ctx = createContext(databaseConfig(),undefined,2);
try {
  await bootstrap(ctx.pool,process.env.APP_PGUSER,process.env.APP_PGPASSWORD);
  console.log('Database bootstrap and migrations applied');
} catch {process.stderr.write('Database bootstrap failed\n');process.exitCode=1;}
finally {await ctx.close();}
