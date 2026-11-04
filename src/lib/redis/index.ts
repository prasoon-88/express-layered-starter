import { type Logger } from 'pino';
import { createClient } from 'redis';

export const createRedisClient = async (url: string, logger: Logger) => {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3_000),
    },
  });

  client.on('error', (err) => {
    logger.error({ err }, 'redis error');
  });

  await client.connect();
  return client;
};

export type Redis = Awaited<ReturnType<typeof createRedisClient>>;
