import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** True when `moduleUrl` is the file node/tsx was told to run. */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
