import ERROR_CODES from "#constants/errorCodes.constant.js";
import HTTP_STATUS from "#constants/httpStatus.constant.js";
import AppError from "./app.error.js";

class BadRequestError extends AppError {
    constructor(message = "Bad Request", code = ERROR_CODES.BAD_REQUEST, details = null){
        super(message, HTTP_STATUS.BAD_REQUEST, code, details)
    }
}

export default BadRequestError