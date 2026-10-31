import HTTP_STATUS from '#constants/httpStatus.constant.js';
import ERROR_CODES from '#constants/errorCodes.constant.js';

class AppError extends Error {
  constructor(
    message,
    statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code = ERROR_CODES.INTERNAL_ERROR,
    details = null,
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

export default AppError;
