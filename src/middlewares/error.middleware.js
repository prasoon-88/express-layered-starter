import { AppError, InternalServerError } from "#errors"
import { convertError } from "#errors/converter"

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