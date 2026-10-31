import ERROR_CODES from '#constants/errorCodes.constant';
import HTTP_STATUS from '#constants/httpStatus.constant';
import type { AppErrorCode } from '#constants/appErrorCodes.constant';
import AppError from './app.error.ts';

class TooManyRequestsError extends AppError {
  constructor(
    message = 'Too many requests',
    code: AppErrorCode = ERROR_CODES.TOO_MANY_REQUESTS,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.TOO_MANY_REQUESTS, code, details);
  }
}

export default TooManyRequestsError;
