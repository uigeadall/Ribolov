import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const __dirname = dirname(fileURLToPath(import.meta.url));

let env: RulesTestEnvironment | null = null;

/** Lazily build the shared test environment from the real firestore.rules.
    Host/port come from FIRESTORE_EMULATOR_HOST (set by `emulators:exec`),
    falling back to the firebase.json default. */
export async function getTestEnv(): Promise<RulesTestEnvironment> {
  if (env) return env;
  const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-ribolov-rules',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host,
      port: Number(portStr),
    },
  });
  return env;
}

/** Seed documents bypassing security rules (for arranging test state). */
export async function seed(
  fn: (db: import('firebase/firestore').Firestore) => Promise<void>,
): Promise<void> {
  const e = await getTestEnv();
  await e.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as import('firebase/firestore').Firestore);
  });
}
