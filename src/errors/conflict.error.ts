import ERROR_CODES from '#constants/errorCodes.constant';
import HTTP_STATUS from '#constants/httpStatus.constant';
import type { AppErrorCode } from '#constants/appErrorCodes.constant';
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
