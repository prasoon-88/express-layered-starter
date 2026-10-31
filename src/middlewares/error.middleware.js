import ENV_CONSTANTS from "#constants/env.constant.js"
import { AppError, InternalServerError } from "#errors"
import { convertError } from "#errors/converter/index.js"
import logger from '#lib/logger/index.js'

const toUnknownError = (err) => {
    const unknownError = new InternalServerError()
    unknownError.isOperational = false
    unknownError.originalError = err
    return unknownError
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
                           req.accepts(['json', 'html']) === 'json'

const errorHandlerMiddleware = (err, req, res, next) =>{
    if (res.headersSent) return next(err);                        

    const error = normalizeError(err)

    const source = error.originalError ?? error

    const errorJsonResp = {
            success: false,
            code: error.code,
            message: error.message,
            requestId: req.id,
            ...(error.details && { details: error.details }),
            ...(ENV_CONSTANTS.ENV !== 'production' && { stack: source.stack })
        }
    
    const level = error.isOperational ? 'warn' : 'error'

    logger[level]({
        err: source,
        requestId: req.id,
        code: error.code,
        statusCode: error.statusCode,
        isOperational: error.isOperational,
    }, "Request Failed");

    if(wantsJson(req)) return res.status(error.statusCode).json(errorJsonResp)
    
    errorJsonResp.statusCode = error.statusCode
    
    return res.status(error.statusCode).render('error', {
        error: errorJsonResp
    })
}

export default errorHandlerMiddleware