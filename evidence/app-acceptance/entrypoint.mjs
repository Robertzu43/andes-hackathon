import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node resolves module URLs physically while argv can retain /var aliases or symlinks.
// Missing/non-file argv is normal when these modules are imported from a REPL/tool.
export function isMain(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try { return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl)); }
  catch { return false; }
}
