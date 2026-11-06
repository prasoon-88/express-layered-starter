import type { Response } from 'express';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';
import { buildSuccessBody } from '#lib/http/successEnvelope';
import { Paginator, type PaginationInput } from '#utils/paginator.util';
import { getLogger } from '#lib/logger/index';

const logger = getLogger('apiResponse.util');

const ERROR_MESSAGES = {
  REDIRECT_REQUIRE_URL: 'redirect requires a url',
};

type SendOptions = {
  message?: string;
  data?: unknown;
  meta?: Record<string, unknown>;
  headers?: Record<string, string>;
};

type ResponseOptions = Omit<SendOptions, 'data'>;

const alreadySent = (res: Response) => {
  if (!res.headersSent) return false;
  logger.warn({ path: res.req.originalUrl }, 'apiResponse called after headers sent');
  return true;
};

const send = (res: Response, status: number, { headers, ...body }: SendOptions = {}) => {
  if (alreadySent(res)) return;
  if (headers) res.set(headers);
  return res.status(status).json(buildSuccessBody(status, body));
};

const ok = (res: Response, data?: unknown, options?: ResponseOptions) =>
  send(res, HTTP_STATUS.OK, { ...options, data });

const created = (res: Response, data?: unknown, options?: ResponseOptions) =>
  send(res, HTTP_STATUS.CREATED, { ...options, data });

const accepted = (res: Response, data?: unknown, options?: ResponseOptions) =>
  send(res, HTTP_STATUS.ACCEPTED, { ...options, data });

const noContent = (res: Response, { headers }: Pick<SendOptions, 'headers'> = {}) => {
  if (alreadySent(res)) return;
  if (headers) res.set(headers);
  return res.status(HTTP_STATUS.NO_CONTENT).end();
};

const redirect = (res: Response, url: string, status: number = HTTP_STATUS.FOUND) => {
  if (alreadySent(res)) return;
  if (!url) throw new Error(ERROR_MESSAGES.REDIRECT_REQUIRE_URL);
  return res.redirect(status, url);
};

const pagination = (
  res: Response,
  items: readonly unknown[],
  { total, page, pageSize }: PaginationInput,
  options?: ResponseOptions,
) =>
  send(res, HTTP_STATUS.OK, {
    ...options,
    data: items,
    meta: Paginator.buildPagination({
      total,
      page,
      pageSize,
    }),
  });

export const apiResponse = {
  ok,
  created,
  accepted,
  noContent,
  redirect,
  pagination,
};
