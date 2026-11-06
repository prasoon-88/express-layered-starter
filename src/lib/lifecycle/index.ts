import type { Server } from 'node:http';
import type { Logger } from 'pino';
import { lifecycleConfig } from '#config/lifecycle.config';
import { getLogger } from '#lib/logger/index';
import { sleep } from '#utils/sleep.util';
import { lifecycleState } from './state.ts';

type ShutdownHook = () => void | Promise<void>;

type ProcessHandlerOptions = {
  server: Server;
  hooks?: ShutdownHook[];
  logger?: Logger;
  timeoutMs?: number;
  drainDelayMs?: number;
  /** Injectable for tests; defaults to the real `process`. */
  proc?: Pick<NodeJS.EventEmitter, 'on'>;
  exit?: (code: number) => void;
};

const toError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));

const isServerNotRunning = (err: Error) => 'code' in err && err.code === 'ERR_SERVER_NOT_RUNNING';

export const registerProcessHandler = ({
  server,
  hooks = [],
  logger = getLogger('lifecycle'),
  timeoutMs = lifecycleConfig.shutdownTimeoutMs,
  drainDelayMs = lifecycleConfig.drainDelayMs,
  proc = process,
  exit = (code) => process.exit(code),
}: ProcessHandlerOptions) => {
  if (!(drainDelayMs < timeoutMs))
    throw new RangeError(
      `drainDelayMs (${drainDelayMs}) must be less than timeoutMs (${timeoutMs})`,
    );

  let isCrashed = false;

  const closeServer = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err && !isServerNotRunning(err)) return reject(err);
        resolve();
      });
      server.closeIdleConnections();
    });

  const runHooks = async () => {
    let failed = false;

    for (const hook of hooks) {
      try {
        await hook();
      } catch (err) {
        failed = true;
        logger.error({ err, hook: hook.name }, 'shutdown hook failed');
      }
    }
    return failed;
  };

  const shutdown = async (reason: string, exitCode: number, { drain = false } = {}) => {
    if (lifecycleState.isShuttingDown()) return;
    lifecycleState.markShutdown();

    const timer = setTimeout(() => {
      logger.error({ reason, timeoutMs }, 'graceful shutdown timed out, forcing exit');
      server.closeAllConnections();
      exit(1);
    }, timeoutMs);

    try {
      if (drain && drainDelayMs) await sleep(drainDelayMs);
      await closeServer();
      if (await runHooks()) exitCode = 1;
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      exitCode = 1;
    }

    clearTimeout(timer);
    exit(isCrashed ? 1 : exitCode);
  };

  const onSignal = (signal: NodeJS.Signals) => {
    if (lifecycleState.isShuttingDown()) {
      logger.warn({ signal }, 'second signal received, forcing exit');
      exit(1);
      return;
    }
    logger.info({ signal }, 'signal received, shutting down');
    shutdown(signal, 0, { drain: true }).catch((err: unknown) => {
      logger.fatal({ err }, 'shutdown failed');
      exit(1);
    });
  };

  const onCrash = (label: string) => (value: unknown) => {
    const err = toError(value);
    if (lifecycleState.isShuttingDown()) {
      isCrashed = true;
      logger.error({ err }, `${label} during shutdown`);
      return;
    }
    logger.fatal({ err }, label);
    shutdown(label, 1).catch((err: unknown) => {
      logger.fatal({ err }, 'shutdown failed');
      exit(1);
    });
  };

  server.on('error', onCrash('server error'));
  proc.on('SIGTERM', onSignal);
  proc.on('SIGINT', onSignal);
  proc.on('unhandledRejection', onCrash('unhandled rejection'));
  proc.on('uncaughtException', onCrash('uncaught exception'));

  return { shutdown };
};
