import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import defaultLogger from '#lib/logger/index';
import { loggerConfig } from '#config/logger.config';
import HTTP_HEADERS from '#constants/httpHeaders.constant';

interface HttpLoggerOptions {
  logger?: Logger;
  ignorePaths?: readonly string[];
  slowRequestMs?: number;
}

const levelFor = ({
  status,
  slow,
  aborted,
}: {
  status: number;
  slow: boolean;
  aborted: boolean;
}) => {
  if (status >= 500) return 'error';
  if (status >= 400 || slow || aborted) return 'warn';
  return 'info';
};

const stripQuery = (url: string) => {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
};

const httpLoggerMiddleware =
  ({
    logger = defaultLogger,
    ignorePaths = loggerConfig.ignorePaths,
    slowRequestMs = loggerConfig.slowRequestMs,
  }: HttpLoggerOptions = {}): RequestHandler =>
  (req, res, next) => {
    const path = stripQuery(req.originalUrl);

    if (ignorePaths.some((p) => p === path || path.startsWith(`${p}/`))) return next();

    const startTime = process.hrtime.bigint();

    let done = false;

    const log = (event: 'finish' | 'close') => {
      if (done) return;
      done = true;

      const endTime = process.hrtime.bigint();
      const durationMs = Math.round((Number(endTime - startTime) / 1e6) * 100) / 100;
      const status = res.statusCode;
      const aborted = event === 'close' && !res.writableFinished;
      const slow = durationMs >= slowRequestMs;

      logger[levelFor({ status, slow, aborted })](
        {
          type: 'http',
          requestId: req.id,
          method: req.method,
          path,
          status,
          durationMs,
          contentLength: res.get(HTTP_HEADERS.CONTENT_LENGTH),
          ip: req.ip,
          userAgent: req.get(HTTP_HEADERS.USER_AGENT),
          ...(res.locals.errorCode && { errorCode: res.locals.errorCode }),
          ...(slow && { slow: true }),
          ...(aborted && { aborted: true }),
        },
        `${req.method} ${path} ${status} ${durationMs}ms`,
      );
    };

    res.once('finish', () => log('finish'));
    res.once('close', () => log('close'));

    next();
  };

export default httpLoggerMiddleware;
