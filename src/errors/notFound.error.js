import ERROR_CODES from "#constants/errorCodes.constant.js";
import HTTP_STATUS from "#constants/httpStatus.constant.js";
import AppError from "./app.error";

class NotFoundError extends AppError{
    constructor(message='Not Found', code=ERROR_CODES.NOT_FOUND, details=null){
        super(message, HTTP_STATUS.NOT_FOUND, code, details)
    }
}

export default NotFoundError