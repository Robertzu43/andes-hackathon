// Run the reviewed, offline toolkits alongside the executable backend checks.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.PYTHON || 'python3';
const recorderTests = readdirSync(new URL('../tests/phone-capability/', import.meta.url))
  .filter(name => name.endsWith('.test.mjs')).sort()
  .map(name => `tests/phone-capability/${name}`);
if (recorderTests.length === 0) throw new Error('No recorder tests found');

const checks = [
  ['recorder', process.execPath, ['--test', ...recorderTests]],
  ...['channels', 'gates', 'checkins', 'contacts'].map(name => [
    name, python, ['-B', '-S', '-m', 'unittest', 'discover', '-s', `evidence/${name}`, '-p', 'test_*.py'],
  ]),
  ['check-in scenarios', python, ['-B', '-S', 'evidence/checkins/run_scenarios.py']],
];

for (const [name, executable, args] of checks) {
  console.log(`\n[tooling] ${name}`);
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) {
    console.error(`Cannot start ${name}; install the documented runtime or set PYTHON to its executable.`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
