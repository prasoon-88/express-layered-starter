import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { CACHE_CONTROL, HTTP_HEADERS } from '#constants/http/httpHeaders.constant';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';

type Representation = { status: number; message: string; data: unknown; meta?: unknown };

export const weakEtag = (representation: unknown) =>
  `W/"${createHash('sha1').update(JSON.stringify(representation)).digest('base64url')}"`;

// Set before res.json(), so Express keeps this tag instead of hashing a body that holds the
// requestId, and its req.fresh check answers a matching If-None-Match with 304.
export const setRepresentationEtag = (
  req: Request,
  res: Response,
  { status, message, data, meta }: Representation,
) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  if (status !== HTTP_STATUS.OK) return;
  if (res.get(HTTP_HEADERS.CACHE_CONTROL)?.includes(CACHE_CONTROL.NO_STORE)) return;
  if (res.get(HTTP_HEADERS.ETAG)) return;
  res.set(HTTP_HEADERS.ETAG, weakEtag({ status, message, data, meta }));
};
