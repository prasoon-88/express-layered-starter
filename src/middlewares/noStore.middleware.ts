import type { RequestHandler } from 'express';
import HTTP_HEADERS from '#constants/http/httpHeaders.constant';

/** Forbids every cache, shared or private, from keeping the response: probes, tokens. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set(HTTP_HEADERS.CACHE_CONTROL, 'no-store');
  next();
};
