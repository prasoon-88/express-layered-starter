import requestContext from '#contexts/requestContext.js';
import HTTP_STATUS from '#constants/httpStatus.constant.js';
import { Paginator } from '#utils/paginator.util.js';
import { getLogger } from '#lib/logger/index.js';

const logger = getLogger('apiResponse');

const MESSAGE = {
  SUCCESS: 'Success',
  CREATED: 'Created',
  ACCEPTED: 'Accepted',
};

const ERROR_MESSAGES = {
  REDIRECT_REQUIRE_URL: 'redirect requires a url',
};

const alreadySent = (res) => {
  if (!res.headersSent) return false;
  logger.warn({ path: res.req?.originalUrl }, 'apiResponse called after headers sent');
  return true;
};

const send = (res, status, { message = MESSAGE.SUCCESS, data = null, meta, headers } = {}) => {
  if (alreadySent(res)) return;
  if (headers) res.set(headers);
  return res.status(status).json({
    success: true,
    message,
    data,
    ...(meta && { meta }),
    requestId: requestContext.getRequestId(),
  });
};

const ok = (res, data, options) => send(res, HTTP_STATUS.OK, { ...options, data });

const created = (res, data, options) =>
  send(res, HTTP_STATUS.CREATED, { message: MESSAGE.CREATED, ...options, data });

const accepted = (res, data, options) =>
  send(res, HTTP_STATUS.ACCEPTED, { message: MESSAGE.ACCEPTED, ...options, data });

const noContent = (res, { headers } = {}) => {
  if (alreadySent(res)) return;
  if (headers) res.set(headers);
  return res.status(HTTP_STATUS.NO_CONTENT).end();
};

const redirect = (res, url, status = HTTP_STATUS.FOUND) => {
  if (alreadySent(res)) return;
  if (!url) throw new Error(ERROR_MESSAGES.REDIRECT_REQUIRE_URL);
  return res.redirect(status, url);
};

const pagination = (res, items, { total, page, pageSize }, options) =>
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
