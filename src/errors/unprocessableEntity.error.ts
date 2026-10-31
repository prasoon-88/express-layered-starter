import ERROR_CODES from '#constants/errorCodes.constant';
import HTTP_STATUS from '#constants/httpStatus.constant';
import type { AppErrorCode } from '#constants/appErrorCodes.constant';
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
