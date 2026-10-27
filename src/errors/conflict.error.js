import ERROR_CODES from "#constants/errorCodes.constant.js";
import HTTP_STATUS from "#constants/httpStatus.constant.js";
import AppError from "./app.error.js";

class ConflictError extends AppError{
    constructor(message='Conflict', code=ERROR_CODES.CONFLICT, details=null){
        super(message, HTTP_STATUS.CONFLICT, code, details)
    }
}

export default ConflictError