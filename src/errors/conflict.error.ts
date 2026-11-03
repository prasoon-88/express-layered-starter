import ERROR_CODES from '#constants/error/errorCodes.constant';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';
import AppError from './app.error.ts';

class ConflictError extends AppError {
  constructor(
    message = 'Conflict',
    code: AppErrorCode = ERROR_CODES.CONFLICT,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.CONFLICT, code, details);
  }
}

export default ConflictError;
