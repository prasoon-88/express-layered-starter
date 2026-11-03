import ERROR_CODES from '#constants/error/errorCodes.constant';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import type { AppErrorCode } from '#constants/error/appErrorCodes.constant';
import AppError from './app.error.ts';

class UnprocessableEntity extends AppError {
  constructor(
    message = 'Unprocessable Entity',
    code: AppErrorCode = ERROR_CODES.VALIDATION_FAILED,
    details: unknown = null,
  ) {
    super(message, HTTP_STATUS.UNPROCESSABLE_ENTITY, code, details);
  }
}

export default UnprocessableEntity;
