import ERROR_CODES from '#constants/error/errorCodes.constant';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';
import AppError from './app.error.ts';

class BadRequestError extends AppError {
  constructor(
    message = 'Bad Request',
    code: AppErrorCode = ERROR_CODES.BAD_REQUEST,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.BAD_REQUEST, code, details);
  }
}

export default BadRequestError;
