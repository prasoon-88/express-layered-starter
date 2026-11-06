import { HTTP_STATUS } from '#constants/http/httpStatus.constant';
import { ERROR_CODES } from '#constants/error/errorCodes.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details: unknown;
  isOperational: boolean;
  /** The raw error this one was converted from, set by the error middleware. */
  originalError?: unknown;

  constructor(
    message: string,
    statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code: AppErrorCode = ERROR_CODES.INTERNAL_ERROR,
    details: unknown = null,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true; // Says that this is a Application ERROR in the middleware
    Error.captureStackTrace(this, this.constructor);
  }
}
