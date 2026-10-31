import HTTP_STATUS from '#constants/httpStatus.constant.js';
import APP_ERROR_CODES from '#constants/appErrorCodes.constant.js';
import STATUS_TO_CODE from '#constants/statusToCode.constant.js';
import { AppError } from '#errors';

const httpErrorConverter = (err) => {
  if (err?.type === 'entity.parse.failed')
    return new AppError('Invalid JSON body', HTTP_STATUS.BAD_REQUEST, APP_ERROR_CODES.INVALID_JSON);

  if (err?.type === 'entity.too.large')
    return new AppError(
      'Request body too large',
      HTTP_STATUS.PAYLOAD_TOO_LARGE,
      APP_ERROR_CODES.PAYLOAD_TOO_LARGE,
    );

  if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported')
    return new AppError(
      'Unsupported content encoding or charset',
      HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
      APP_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
    );

  const status = err.status ?? err.statusCode;

  if (Number.isInteger(status) && status >= 400 && status <= 500 && err.expose === true)
    return new AppError(err.message, status, STATUS_TO_CODE[status] ?? APP_ERROR_CODES.BAD_REQUEST);

  return null;
};

export default httpErrorConverter;
