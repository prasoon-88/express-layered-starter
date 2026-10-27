import ERROR_CODES from "#constants/errorCodes.constant.js";
import HTTP_STATUS from "#constants/httpStatus.constant.js";
import AppError from "./app.error";

class TooManyRequestsError extends AppError{
    constructor(message='Too many requests', code=ERROR_CODES.TOO_MANY_REQUESTS, details=null){
        super(message, HTTP_STATUS.TOO_MANY_REQUESTS, code, details)
    }
}

export default TooManyRequestsError