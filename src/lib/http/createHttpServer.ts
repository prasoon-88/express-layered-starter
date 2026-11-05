import type { Express } from 'express';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Env } from '#constants/env/schema';

export type HttpServerConfig = {
  app: Express;
  env: Env;
};

type CreateHttpServer = (
  props: HttpServerConfig,
) => Server<typeof IncomingMessage, typeof ServerResponse>;

export const createHttpServer: CreateHttpServer = ({ app, env }) =>
  createServer(
    {
      keepAliveTimeout: env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
      headersTimeout: env.HTTP_HEADERS_TIMEOUT_MS,
      requestTimeout: env.HTTP_REQUEST_TIMEOUT_MS,
    },
    app,
  );
