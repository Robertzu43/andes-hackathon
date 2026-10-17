import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTRACT } from './fixtures.mjs';
import { runQueueProbes } from './queue-probes.mjs';

try {
  const { values } = parseArgs({ options: { collector: { type: 'string' }, candidate: { type: 'string' } } });
  if (!values.collector || !/^[0-9a-f]{40}$/.test(values.candidate ?? '')) throw new TypeError('Missing frozen collector');
  const module = await import(pathToFileURL(resolve(values.collector)).href);
  const checks = await runQueueProbes(module.collectQueueTrace);
  const passed = checks.every(check => check.passed);
  console.log(JSON.stringify({
    schema: 'andes.reviewer-queue-probes/1', claimedCandidateSha: values.candidate,
    candidateIdentityVerifiedByRunner: false, backendContract: CONTRACT.backend, passed, checks,
    limitation: 'Reviewer must inspect the collector and archived candidate. Normalized traces do not authenticate persistence, browser reload, identity or device/provider evidence.',
  }, null, 2));
  process.exitCode = passed ? 0 : 1;
} catch {
  console.error('Cannot run queue probes: supply a local reviewer collector and an exact candidate SHA.');
  process.exitCode = 2;
}
