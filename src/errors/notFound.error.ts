import { ERROR_CODES } from '#constants/error/errorCodes.constant';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';
import { AppError } from './app.error.ts';

export class NotFoundError extends AppError {
  constructor(
    message = 'Not Found',
    code: AppErrorCode = ERROR_CODES.NOT_FOUND,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.NOT_FOUND, code, details);
  }
}
