import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Copy Chrome captures out of the temp dir only when a destination is set. */
export async function copyPhoneCaptures(shotDir, destination) {
  if (!destination) return false;
  await mkdir(destination, { recursive: true });
  await cp(join(shotDir, 'captures'), destination, { recursive: true });
  return true;
}
