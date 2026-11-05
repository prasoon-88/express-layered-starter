import requestContext from '#contexts/requestContext';
import HTTP_STATUS from '#constants/http/httpStatus.constant';

// The one place a success body is shaped. `apiResponse` (utils/) and `route()` both call it,
// so a handler gets the same `{ success, message, data, requestId }` whichever way it responds.
// It lives in lib/ because lib/ may not import utils/, and route() needs it.

const DEFAULT_MESSAGE = 'Success';

const MESSAGE_BY_STATUS: Readonly<Record<number, string>> = {
  [HTTP_STATUS.CREATED]: 'Created',
  [HTTP_STATUS.ACCEPTED]: 'Accepted',
};

export type SuccessBodyInput = {
  message?: string;
  data?: unknown;
  meta?: Record<string, unknown>;
};

export const buildSuccessBody = (
  status: number,
  { message, data = null, meta }: SuccessBodyInput = {},
) => ({
  success: true,
  message: message ?? MESSAGE_BY_STATUS[status] ?? DEFAULT_MESSAGE,
  data,
  ...(meta && { meta }),
  requestId: requestContext.getRequestId(),
});
