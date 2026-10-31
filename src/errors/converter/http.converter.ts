import HTTP_STATUS from '#constants/httpStatus.constant';
import APP_ERROR_CODES from '#constants/appErrorCodes.constant';
import STATUS_TO_CODE from '#constants/statusToCode.constant';
import { AppError } from '#errors';

// Errors from Express's body parsers (http-errors) carry these extra, untyped fields.
type HttpLikeError = Error & {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
  expose?: unknown;
};

const httpErrorConverter = (err: unknown) => {
  if (!(err instanceof Error)) return null;
  const httpErr: HttpLikeError = err;

  if (httpErr.type === 'entity.parse.failed')
    return new AppError('Invalid JSON body', HTTP_STATUS.BAD_REQUEST, APP_ERROR_CODES.INVALID_JSON);

  if (httpErr.type === 'entity.too.large')
    return new AppError(
      'Request body too large',
      HTTP_STATUS.PAYLOAD_TOO_LARGE,
      APP_ERROR_CODES.PAYLOAD_TOO_LARGE,
    );

  if (httpErr.type === 'encoding.unsupported' || httpErr.type === 'charset.unsupported')
    return new AppError(
      'Unsupported content encoding or charset',
      HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
      APP_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
    );

  const status = httpErr.status ?? httpErr.statusCode;

  if (
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 500 &&
    httpErr.expose === true
  )
    return new AppError(
      httpErr.message,
      status,
      STATUS_TO_CODE[status] ?? APP_ERROR_CODES.BAD_REQUEST,
    );

  return null;
};

export default httpErrorConverter;
