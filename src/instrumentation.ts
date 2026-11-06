// Loaded before the app with `node --import` (pnpm dev, pnpm start, the Docker image).
//
// Instrumentation works by patching express, http, redis and pino as they load. An ES module
// links all of its imports before any of its code runs, so starting OpenTelemetry from inside
// server.ts would be too late: everything would already be loaded, unpatched.
//
// The loader hook is Node's synchronous module.registerHooks() (through import-in-the-middle),
// not module.register(), which Node 26 deprecates (DEP0205).
import { register } from 'import-in-the-middle/register-hooks.mjs';
import { telemetryConfig } from '#config/telemetry.config';

if (telemetryConfig.enabled) {
  register();
  // Imported after the hook is in place, so the modules it pulls in are patched too.
  const { startTelemetry } = await import('#lib/telemetry/index');
  startTelemetry();
}
