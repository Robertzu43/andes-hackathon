import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTRACT } from './fixtures.mjs';
import { runApiProbes } from './api-probes.mjs';

try {
  const { values } = parseArgs({ options: {
    driver: { type: 'string' }, candidate: { type: 'string' },
  } });
  if (!values.driver || !/^[0-9a-f]{40}$/.test(values.candidate ?? '')) {
    throw new TypeError('Driver path and exact candidate SHA are required');
  }
  const driver = await import(pathToFileURL(resolve(values.driver)).href);
  const checks = await runApiProbes(driver.createApiDriver);
  const passed = checks.every(check => check.passed);
  console.log(JSON.stringify({
    schema: 'andes.reviewer-client-probes/1',
    claimedCandidateSha: values.candidate, candidateIdentityVerifiedByRunner: false,
    backendContract: CONTRACT.backend, scope: 'api-driver-conformance', passed, checks,
    limitation: 'Reviewer must verify the archived candidate and transparent driver binding. No backend, browser, device, identity or provider qualification.',
  }, null, 2));
  process.exitCode = passed ? 0 : 1;
} catch {
  console.error('Cannot run API probes: supply a local reviewer driver with createApiDriver and an exact candidate SHA.');
  process.exitCode = 2;
}
