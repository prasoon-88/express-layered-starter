import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { HTTP_HEADERS } from '#constants/http/httpHeaders.constant';
import { REGEX } from '#constants/regex.constant';
import { requestContext } from '#contexts/requestContext';

type RequestIdOptions = {
  header?: string;
  trustIncoming?: boolean;
  generator?: () => string;
};

export const createRequestIdMiddleware =
  ({
    header = HTTP_HEADERS.X_REQUEST_ID,
    trustIncoming = true,
    generator = randomUUID,
  }: RequestIdOptions = {}): RequestHandler =>
  (req, res, next) => {
    const incomingId = trustIncoming ? req.get(header) : undefined;

    const id =
      typeof incomingId === 'string' && REGEX.SAFE_ID.test(incomingId) ? incomingId : generator();

    req.id = id;
    res.set(header, id);

    requestContext.run({ [requestContext.STORE_KEYS.REQUEST_ID]: id }, next);
  };
