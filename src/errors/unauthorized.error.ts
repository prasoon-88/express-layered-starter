import ERROR_CODES from '#constants/error/errorCodes.constant';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';
import AppError from './app.error.ts';

class UnauthorizedError extends AppError {
  constructor(
    message = 'Unauthorized',
    code: AppErrorCode = ERROR_CODES.UNAUTHORIZED,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.UNAUTHORIZED, code, details);
  }
}

export default UnauthorizedError;
