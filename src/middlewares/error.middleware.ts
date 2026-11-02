import type { ErrorRequestHandler, Request } from 'express';
import ENV_CONSTANTS from '#constants/env/index';
import { AppError, InternalServerError } from '#errors';
import { convertError } from '#errors/converter/index';
import logger from '#lib/logger/index';

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
const errorHandlerMiddleware: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) return next(err);

  const error = normalizeError(err);

  const source = error.originalError ?? error;

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

  if (wantsJson(req)) return res.status(error.statusCode).json(errorJsonResp);

  return res.status(error.statusCode).render('error', {
    error: { ...errorJsonResp, statusCode: error.statusCode },
  });
};

export default errorHandlerMiddleware;
