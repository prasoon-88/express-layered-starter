import { ERROR_CODES } from '#constants/error/errorCodes.constant';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';
import { AppError } from './app.error.ts';

export class TooManyRequestsError extends AppError {
  constructor(
    message = 'Too many requests',
    code: AppErrorCode = ERROR_CODES.TOO_MANY_REQUESTS,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.TOO_MANY_REQUESTS, code, details);
  }
}
