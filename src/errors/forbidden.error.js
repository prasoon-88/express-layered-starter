import ERROR_CODES from '#constants/errorCodes.constant.js';
import HTTP_STATUS from '#constants/httpStatus.constant.js';
import AppError from './app.error.js';

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = ERROR_CODES.FORBIDDEN, details = null) {
    super(message, HTTP_STATUS.FORBIDDEN, code, details);
  }
}

export default ForbiddenError;
