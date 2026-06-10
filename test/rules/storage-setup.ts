import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const __dirname = dirname(fileURLToPath(import.meta.url));

let env: RulesTestEnvironment | null = null;

/** Lazily build a Storage-only test environment from the real storage.rules.
    Host/port come from FIREBASE_STORAGE_EMULATOR_HOST (set by `emulators:exec
    --only storage`), falling back to the firebase.json default port 9199. */
export async function getStorageEnv(): Promise<RulesTestEnvironment> {
  if (env) return env;
  const hostPort = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199').replace(/^https?:\/\//, '');
  const [host, portStr] = hostPort.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-ribolov-storage',
    storage: {
      rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8'),
      host,
      port: Number(portStr),
    },
  });
  return env;
}
