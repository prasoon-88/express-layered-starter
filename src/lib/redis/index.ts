import { createHash } from 'node:crypto';
import { Redis, type ChainableCommander } from 'ioredis';
import { type Logger } from 'pino';

export type { Redis } from 'ioredis';

type RedisClientOptions = {
  // Bounds one connection attempt and how long startup waits for the first one.
  connectTimeoutMs: number;
};

const MAX_RECONNECT_DELAY_MS = 3_000;
const RECONNECT_STEP_MS = 100;

// Resolves once connected, or after connectTimeoutMs with the client still reconnecting in the
// background. Startup never hangs on an unreachable Redis: until the client is ready, commands
// fail fast (no offline queue), so callers see a store error instead of a request that waits.
export const createRedisClient = async (
  url: string,
  logger: Logger,
  { connectTimeoutMs }: RedisClientOptions,
): Promise<Redis> => {
  const client = new Redis(url, {
    // connect() below starts it, so the first attempt is the one startup waits for.
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: connectTimeoutMs,
    retryStrategy: (attempt) => Math.min(attempt * RECONNECT_STEP_MS, MAX_RECONNECT_DELAY_MS),
  });

  client.on('error', (err: unknown) => {
    logger.error({ err }, 'redis error');
  });

  // Rejects when the first attempt fails; retryStrategy keeps reconnecting regardless.
  const connecting = client.connect().then(
    () => true,
    (err: unknown) => {
      logger.error({ err }, 'redis first connection attempt failed');
      return false;
    },
  );

  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), connectTimeoutMs);
  });
  const connected = await Promise.race([connecting, timedOut]);
  clearTimeout(timer);

  if (!connected)
    logger.warn(
      { connectTimeoutMs },
      'redis is not reachable at startup; continuing while it reconnects in the background',
    );

  return client;
};

type DuplicateOptions = {
  commandTimeoutMs: number;
  /** Names the connection in its error logs. */
  name: string;
  /** Batches the commands sent in one tick into one write: for many small, independent commands. */
  autoPipelining?: boolean;
};

/**
 * A second connection with the same settings plus a per-command timeout, for a feature whose
 * slow commands must not hold up the others (or theirs). The caller closes it.
 */
export const duplicateRedisClient = (
  client: Redis,
  logger: Logger,
  { commandTimeoutMs, name, autoPipelining = false }: DuplicateOptions,
): Redis => {
  // The original connects lazily, from createRedisClient; a copy has nobody to start it.
  const copy = client.duplicate({
    lazyConnect: false,
    commandTimeout: commandTimeoutMs,
    enableAutoPipelining: autoPipelining,
  });
  copy.on('error', (err: unknown) => {
    logger.error({ err, connection: name }, 'redis error');
  });
  return copy;
};

/**
 * Runs a MULTI and throws its first failed command. ioredis resolves a transaction with one
 * `[error, result]` pair per command instead of rejecting, so a failed write would pass silently.
 */
export const execOrThrow = async (transaction: ChainableCommander): Promise<unknown[]> => {
  const replies = await transaction.exec();
  // Null only when a WATCHed key changed; nothing here WATCHes, so it is a bug if it happens.
  if (!replies) throw new Error('Redis transaction was aborted');
  return replies.map(([err, value]) => {
    if (err) throw err;
    return value;
  });
};

/**
 * A Lua script sent by its SHA-1 (EVALSHA), so a hot path does not send its source every time.
 * A server that does not know it yet (first use, a restart, a failover) answers NOSCRIPT, and the
 * source is sent once with EVAL, which also loads it.
 */
export const defineScript = (source: string) => {
  const sha = createHash('sha1').update(source).digest('hex');
  return async (
    client: Pick<Redis, 'evalsha' | 'eval'>,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<unknown> => {
    try {
      return await client.evalsha(sha, keys.length, ...keys, ...args);
    } catch (err) {
      if (!(err instanceof Error && err.message.startsWith('NOSCRIPT'))) throw err;
      return client.eval(source, keys.length, ...keys, ...args);
    }
  };
};

// quit() waits for in-flight commands, but only works on a ready connection.
// A client that never connected (or is between reconnects) has nothing to flush, so it is dropped.
export const closeRedisClient = async (client: Pick<Redis, 'status' | 'quit' | 'disconnect'>) => {
  if (client.status === 'ready') await client.quit();
  else if (client.status !== 'end') client.disconnect();
};
