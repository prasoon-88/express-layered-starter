import ERROR_CODES from "#constants/errorCodes.constant.js";
import HTTP_STATUS from "#constants/httpStatus.constant.js";
import AppError from "./app.error.js";

class InternalServer extends AppError{
    constructor(message='Internal Server Error', code=ERROR_CODES.INTERNAL_ERROR, details=null){
        super(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, code, details)
    }
}

export default InternalServer