import ERROR_CODES from '#constants/errorCodes.constant.js';
import HTTP_STATUS from '#constants/httpStatus.constant.js';
import AppError from './app.error.js';

class ServiceUnavailable extends AppError {
  constructor(
    message = 'Service Unavailable',
    code = ERROR_CODES.SERVICE_UNAVAILABLE,
    details = null,
  ) {
    super(message, HTTP_STATUS.SERVICE_UNAVAILABLE, code, details);
  }
}

export default ServiceUnavailable;
