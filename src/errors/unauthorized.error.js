import ERROR_CODES from "#constants/errorCodes.constant.js";
import HTTP_STATUS from "#constants/httpStatus.constant.js";
import AppError from "./app.error";

class UnauthorizedError extends AppError{
    constructor(message='Unauthorized', code=ERROR_CODES.UNAUTHORIZED, details=null){
        super(message, HTTP_STATUS.UNAUTHORIZED, code, details)
    }
}

export default UnauthorizedError