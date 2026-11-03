import ERROR_CODES from '#constants/error/errorCodes.constant';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';
import AppError from './app.error.ts';

class ForbiddenError extends AppError {
  constructor(
    message = 'Forbidden',
    code: AppErrorCode = ERROR_CODES.FORBIDDEN,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.FORBIDDEN, code, details);
  }
}

export default ForbiddenError;
