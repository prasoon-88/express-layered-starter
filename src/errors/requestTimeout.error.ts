import { AppError } from './app.error.ts';
import { ERROR_CODES } from '#constants/error/errorCodes.constant';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';

export class RequestTimeoutError extends AppError {
  constructor(timeoutMs: number) {
    super(
      `Request exceeds ${timeoutMs}ms`,
      HTTP_STATUS.REQUEST_TIMEOUT,
      ERROR_CODES.REQUEST_TIMEOUT,
    );
  }
}
