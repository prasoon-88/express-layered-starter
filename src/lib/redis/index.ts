import { type Logger } from 'pino';
import { createClient } from 'redis';

type RedisClientOptions = {
  // Bounds one connection attempt and how long startup waits for the first one.
  connectTimeoutMs: number;
};

// Resolves once connected, or after connectTimeoutMs with the client still reconnecting in the
// background. Startup never hangs on an unreachable Redis: until the client is ready, commands
// fail fast (no offline queue), so callers see a store error instead of a request that waits.
export const createRedisClient = async (
  url: string,
  logger: Logger,
  { connectTimeoutMs }: RedisClientOptions,
) => {
  const client = createClient({
    url,
    // Nothing here needs RESP3, and its HELLO handshake is rejected by Redis older than 6.
    RESP: 2,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: connectTimeoutMs,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3_000),
    },
  });

  client.on('error', (err) => {
    logger.error({ err }, 'redis error');
  });

  const connecting = client.connect().then(
    () => true,
    (err: unknown) => {
      logger.error({ err }, 'redis connect gave up');
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

export type Redis = Awaited<ReturnType<typeof createRedisClient>>;

// close() waits for in-flight commands, but only works on a ready connection.
// A client that never connected (or is between reconnects) has nothing to flush, so it is destroyed.
export const closeRedisClient = async (
  client: Pick<Redis, 'isReady' | 'isOpen' | 'close' | 'destroy'>,
) => {
  if (client.isReady) await client.close();
  else if (client.isOpen) client.destroy();
};
