import ERROR_CODES from '#constants/errorCodes.constant';
import HTTP_STATUS from '#constants/httpStatus.constant';
import type { AppErrorCode } from '#constants/appErrorCodes.constant';
import AppError from './app.error.ts';

class InternalServer extends AppError {
  constructor(
    message = 'Internal Server Error',
    code: AppErrorCode = ERROR_CODES.INTERNAL_ERROR,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, code, details);
  }
}

export default InternalServer;
