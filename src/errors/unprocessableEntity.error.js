import ERROR_CODES from "#constants/errorCodes.constant.js";
import HTTP_STATUS from "#constants/httpStatus.constant.js";
import AppError from "./app.error.js";

class UnprocessableEntity extends AppError{
    constructor(message='Unprocessable Entity', code=ERROR_CODES.VALIDATION_FAILED, details=null){
        super(message, HTTP_STATUS.UNPROCESSABLE_ENTITY, code, details)
    }
}

export default UnprocessableEntity