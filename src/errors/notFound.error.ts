import ERROR_CODES from '#constants/errorCodes.constant';
import HTTP_STATUS from '#constants/httpStatus.constant';
import type { AppErrorCode } from '#constants/appErrorCodes.constant';
import AppError from './app.error.ts';

class NotFoundError extends AppError {
  constructor(
    message = 'Not Found',
    code: AppErrorCode = ERROR_CODES.NOT_FOUND,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.NOT_FOUND, code, details);
  }
}

export default NotFoundError;
