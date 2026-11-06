// What the app needs to know about telemetry, without importing the SDK: server.ts reads this
// whether or not the preload started anything, and must not pull the SDK in when it did not.

type Running = { shutdown: () => Promise<void> };

let running: Running | undefined;

export const markTelemetryStarted = (sdk: Running) => {
  running = sdk;
};

export const isTelemetryStarted = () => running !== undefined;

/** Flushes buffered spans and metrics. A shutdown hook: the last ones are otherwise lost. */
export const shutdownTelemetry = async () => {
  await running?.shutdown();
};
