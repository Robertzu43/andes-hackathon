import {createContext} from '../../dist/db.js';
import {claimJob, authorizeJob} from '../../dist/notifications/dispatch.js';
import {provider} from '../../tests/helpers/dispatch.mjs';

// A committed SQL boundary followed by SIGKILL; no network send is performed.
const [phase, body, now] = process.argv.slice(2);
const ctx = createContext(process.env.TEST_DATABASE_URL, () => new Date(now));
const job = JSON.parse(body);
const claim = await claimJob(ctx, job, 'review-child');
if (!claim) throw new Error('Child did not acquire the synthetic job');
if (phase === 'authorized') {
  if (!await authorizeJob(ctx, claim, provider())) throw new Error('Child did not authorize the synthetic attempt');
}
process.send({phase});
