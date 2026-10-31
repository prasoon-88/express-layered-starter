import HTTP_STATUS from '#constants/httpStatus.constant.js';
import APP_ERROR_CODES from '#constants/appErrorCodes.constant.js';
import { AppError } from '#errors';

const jwtConverter = (err) => {
  switch (err.name) {
    case 'TokenExpiredError':
      return new AppError('Token expired', HTTP_STATUS.UNAUTHORIZED, APP_ERROR_CODES.TOKEN_EXPIRED);
    case 'NotBeforeError':
      return new AppError(
        'Token not active yet',
        HTTP_STATUS.UNAUTHORIZED,
        APP_ERROR_CODES.TOKEN_INVALID,
      );
    case 'JsonWebTokenError':
      return new AppError('Invalid token', HTTP_STATUS.UNAUTHORIZED, APP_ERROR_CODES.TOKEN_INVALID);
  }

  return null;
};

export default jwtConverter;
