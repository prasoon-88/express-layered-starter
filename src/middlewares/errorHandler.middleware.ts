import type { ErrorRequestHandler, Request } from 'express';
import { ENV_CONSTANTS } from '#constants/env/index';
import { CACHE_CONTROL, HTTP_HEADERS } from '#constants/http/httpHeaders.constant';
import { AppError, InternalServerError } from '#errors';
import { convertError } from '#errors/converter/index';
import { logger } from '#lib/logger/index';

const toUnknownError = (err: unknown) => {
  const unknownError = new InternalServerError();
  unknownError.isOperational = false;
  unknownError.originalError = err;
  return unknownError;
};

const normalizeError = (err: unknown): AppError => {
  if (err instanceof AppError) return err;

  const converted = convertError(err);

  if (!converted) return toUnknownError(err);

  converted.originalError = err;
  return converted;
};

const wantsJson = (req: Request) =>
  req.originalUrl.startsWith('/api') || req.xhr || req.accepts(['json', 'html']) === 'json';

// Anything can be thrown in JS, so `err` is `unknown` and must be narrowed before use.
export const errorHandlerMiddleware: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) return next(err);

  const error = normalizeError(err);

  const source = error.originalError ?? error;

  res.locals.errorCode = error.code; // read by httpLogger for the access log line

  const errorJsonResp = {
    success: false,
    code: error.code,
    message: error.message,
    requestId: req.id,
    ...(error.details ? { details: error.details } : {}),
    ...(ENV_CONSTANTS.EXPOSE_ERROR_STACK && {
      stack: source instanceof Error ? source.stack : undefined,
    }),
  };

  const level = error.isOperational ? 'warn' : 'error';

  logger[level](
    {
      err: source,
      requestId: req.id,
      code: error.code,
      statusCode: error.statusCode,
      isOperational: error.isOperational,
    },
    'Request Failed',
  );

  // The route's rule describes its success response, so an error must never inherit a max-age.
  res.set(HTTP_HEADERS.CACHE_CONTROL, CACHE_CONTROL.NO_STORE);

  if (wantsJson(req)) return res.status(error.statusCode).json(errorJsonResp);

  return res.status(error.statusCode).render('error', {
    error: { ...errorJsonResp, statusCode: error.statusCode },
  });
};
