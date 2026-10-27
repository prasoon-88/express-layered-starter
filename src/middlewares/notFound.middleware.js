import ERROR_CODES from '#constants/errorCodes.constant.js'
import { NotFoundError } from '#errors'

const notFoundMiddleware = (req, res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`, ERROR_CODES.ROUTE_NOT_FOUND))
}

export default notFoundMiddleware