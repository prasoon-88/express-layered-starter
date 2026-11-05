import type { NextFunction, Request, Response } from 'express';
import { getLogger } from '#lib/logger/index';
import RequestTimeoutError from '#errors/requestTimeout.error';
import HTTP_HEADERS from '#constants/http/httpHeaders.constant';

const logger = getLogger('request-timeout');

type Deadline = {
  controller: AbortController;
  startedAt: number;
  timer?: NodeJS.Timeout;
};

const deadlines = new WeakMap<Request, Deadline>();

const getOrCreateDeadline = (req: Request, res: Response): Deadline => {
  const existing = deadlines.get(req);
  if (existing) return existing;

  const deadline: Deadline = {
    controller: new AbortController(),
    startedAt: Date.now(),
  };

  deadlines.set(req, deadline);
  // Node's req.signal is read-only and aborts only when the socket closes.
  // This one aborts when the handler budget runs out, or the client leaves first.
  req.deadline = deadline.controller.signal;

  res.once('close', () => {
    if (deadline.timer) clearTimeout(deadline.timer);
    if (!res.writableFinished) deadline.controller.abort(new Error('client closed request'));
  });

  return deadline;
};

const handleTimeout = (
  req: Request,
  res: Response,
  next: NextFunction,
  deadline: Deadline,
  ms: number,
) => {
  if (res.writableEnded || res.destroyed) return; // answered just in time
  const err = new RequestTimeoutError(ms);
  deadline.controller.abort(err); // tell the handler to stop working

  logger.warn(
    {
      reqId: req.id,
      method: req.method,
      url: req.originalUrl,
      ms,
      elapsedMs: Date.now() - deadline.startedAt,
    },
    'request timed out',
  );

  if (res.headersSent) {
    res.destroy(); // a half-sent response cannot be fixed, so drop the connection
    return;
  }

  res.setHeader(HTTP_HEADERS.CONNECTION, 'close'); // do not reuse a socket with an unread body
  next(err);
};

export const requestTimeoutMiddleware =
  (ms: number) => (req: Request, res: Response, next: NextFunction) => {
    const deadline = getOrCreateDeadline(req, res);
    clearTimeout(deadline.timer);

    if (ms <= 0) return next();

    deadline.timer = setTimeout(() => handleTimeout(req, res, next, deadline, ms), ms);
    next();
  };
