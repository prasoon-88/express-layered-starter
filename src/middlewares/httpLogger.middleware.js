import defaultLogger from "#lib/logger/index.js"
import { loggerConfig } from "#config/logger.config.js"
import HTTP_HEADERS from "#constants/httpHeaders.constant.js"

const levelFor = ({ status, slow, aborted })=>{
    if(status >= 500) return 'error'
    if(status >= 400 || slow || aborted) return 'warn'
    return 'info'
}

const httpLoggerMiddleware = ({
    logger = defaultLogger,
    ignorePaths = loggerConfig.ignorePaths,
    slowRequestMs = loggerConfig.slowRequestMs
} = {}) => (req, res, next) => {
    const path = req.originalUrl.split("?").at(0)

    if(ignorePaths.some((p)=> p === path || path.startsWith(`${p}/`))) return next()

    const startTime = process.hrtime.bigint()

    let done = false

    const log = (event) =>{
        if(done) return
        done = true

        const endTime = process.hrtime.bigint()
        const durationMs = Math.round(Number(endTime - startTime) / 1e6 * 100) / 100
        const status = res.statusCode
        const aborted = event === 'close' && !res.writableFinished
        const slow = durationMs >= slowRequestMs

        logger[levelFor({ status, slow, aborted })](
            {
                type: 'http',
                requestId: req.id,
                method: req.method,
                path,
                status,
                durationMs,
                contentLength: res.get(HTTP_HEADERS.CONTENT_LENGTH),
                ip: req.ip,
                userAgent: req.get(HTTP_HEADERS.USER_AGENT),
                ...(res.locals.errorCode && { errorCode: res.locals.errorCode }),
                ...(slow && { slow: true }),
                ...(aborted && { aborted: true }),
            },
            `${req.method} ${path} ${status} ${durationMs}ms`
        )
    }

    res.once('finish', ()=> log('finish'))
    res.once('close', ()=> log('close'))

    next()
}

export default httpLoggerMiddleware