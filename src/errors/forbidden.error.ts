import ERROR_CODES from '#constants/errorCodes.constant';
import HTTP_STATUS from '#constants/httpStatus.constant';
import type { AppErrorCode } from '#constants/appErrorCodes.constant';
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
