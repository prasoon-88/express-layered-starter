import { ERROR_CODES } from '#constants/error/errorCodes.constant';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';
import { AppError } from './app.error.ts';

export class InternalServerError extends AppError {
  constructor(
    message = 'Internal Server Error',
    code: AppErrorCode = ERROR_CODES.INTERNAL_ERROR,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, code, details);
  }
}
