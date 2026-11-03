import ERROR_CODES from '#constants/error/errorCodes.constant';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';
import AppError from './app.error.ts';

class ServiceUnavailable extends AppError {
  constructor(
    message = 'Service Unavailable',
    code: AppErrorCode = ERROR_CODES.SERVICE_UNAVAILABLE,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.SERVICE_UNAVAILABLE, code, details);
  }
}

export default ServiceUnavailable;
