import { readFileSync, statSync } from 'node:fs';
import { isMain } from './entrypoint.mjs';
import { evaluate } from './oracle.mjs';

export function checkFile(path) {
  if (statSync(path).size > 512 * 1024) throw new Error('receipt exceeds 512 KiB');
  return evaluate(JSON.parse(readFileSync(path, 'utf8')));
}
if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('usage: node evidence/app-acceptance/check.mjs <receipt.json>');
    const result = checkFile(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.disposition === 'fix' ? 1 : result.disposition === 'inconclusive' ? 2 : 0;
  } catch {
    // Never echo receipt paths, tokens, personal payloads or filesystem error strings.
    console.log(JSON.stringify({ disposition: 'fix', errors: ['invalid or unreadable receipt'], wholeAppAccepted: false }));
    process.exitCode = 1;
  }
}
