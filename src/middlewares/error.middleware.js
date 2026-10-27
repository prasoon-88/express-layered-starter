import APP_ERROR_CODES from "#constants/appErrorCodes.constant.js"
import HTTP_STATUS from "#constants/httpStatus.constant.js"
import { AppError, InternalServerError } from "#errors"

const errorMap = {
    CastError: (e) => new AppError(`Invalid ${e.path}`, HTTP_STATUS.BAD_REQUEST, APP_ERROR_CODES.INVALID_ID),
    ValidationError: (e) =>
        new AppError("Validation failed", HTTP_STATUS.BAD_REQUEST, APP_ERROR_CODES.VALIDATION_FAILED,
            e.errors
                ? Object.values(e.errors).map((x) => ({ field: x.path, message: x.message }))
                : null
            ),
    TokenExpiredError: () => new AppError("Token expired", HTTP_STATUS.UNAUTHORIZED, APP_ERROR_CODES.TOKEN_EXPIRED),
    JsonWebTokenError: () => new AppError("Invalid token", HTTP_STATUS.UNAUTHORIZED, APP_ERROR_CODES.TOKEN_INVALID),
}

const toUnknownError = (err) => {
    const unknownError = new InternalServerError()
    unknownError.isOperational = false
    unknownError.originalError = err
    return unknownError
}

const convertError = (err) =>{
    // MongoDB duplicate key                                      
    if (err?.code === 11000) {
        const field = Object.keys(err.keyValue || {})[0];
        return new AppError(field ? `${field} already exists` : "Duplicate value", HTTP_STATUS.CONFLICT, APP_ERROR_CODES.DUPLICATE_KEY);
    }

    // body-parser errors                                         
    if (err?.type === "entity.parse.failed")
        return new AppError("Invalid JSON body", HTTP_STATUS.BAD_REQUEST, APP_ERROR_CODES.INVALID_JSON);
    if (err?.type === "entity.too.large")
        return new AppError("Request body too large", HTTP_STATUS.PAYLOAD_TOO_LARGE, APP_ERROR_CODES.PAYLOAD_TOO_LARGE);

    if(Object.hasOwn(errorMap, err?.name)) return errorMap[err.name](err)
        
    return null
}

const normalizeError = (err) =>{
    if(err instanceof AppError) return err
    
    const converted = convertError(err)

    if(!converted) return toUnknownError(err)

    converted.originalError = err
    return converted
}

const wantsJson = (req) => req.originalUrl.startsWith('/api') ||
                           req.xhr ||
                           req.accepts(['html', 'json']) === 'json'

const errorHandlerMiddleware = (err, req, res, next) =>{
    if (res.headersSent) return next(err);                        

    const error = normalizeError(err)
    if(!error.isOperational) console.error(error.originalError)

    const source = error.originalError ?? error

    const errorJsonResp = {
            success: false,
            code: error.code,
            message: error.message,
            ...(error.details && { details: error.details }),
            ...(process.env.NODE_ENV !== 'production' && { stack: source.stack })
        }

    if(wantsJson(req)) return res.status(error.statusCode).json(errorJsonResp)
    
    errorJsonResp.statusCode = error.statusCode
    
    return res.status(error.statusCode).render('error', {
        error: errorJsonResp
    })
}

export default errorHandlerMiddleware