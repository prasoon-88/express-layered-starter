import type { RequestHandler } from 'express';
import ERROR_CODES from '#constants/error/errorCodes.constant';
import { NotFoundError } from '#errors';

const notFoundMiddleware: RequestHandler = (req, res, next) => {
  next(
    new NotFoundError(
      `Route ${req.method} ${req.originalUrl} not found`,
      ERROR_CODES.ROUTE_NOT_FOUND,
    ),
  );
};

export default notFoundMiddleware;
