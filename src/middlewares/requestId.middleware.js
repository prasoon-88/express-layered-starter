import { randomUUID } from 'node:crypto'
import HTTP_HEADERS from '#constants/httpHeaders.constant.js'
import REGEX from '#constants/regex.constant.js'
import requestContext from '#contexts/requestContext.js'

const requestIdMiddleware = ({
    header = HTTP_HEADERS.X_REQUEST_ID,
    trustIncoming = true,
    generator = randomUUID,
} = {}) => (req, res, next) => {
    const incomingId = trustIncoming ? req.get(header) : undefined

    const id =
        typeof incomingId === 'string' &&
        REGEX.SAFE_ID.test(incomingId)
            ? incomingId
            : generator()

    req.id = id
    res.set(header, id)

    requestContext.run(
        { [requestContext.STORE_KEYS.REQUEST_ID]: id },
        next
    )
}

export default requestIdMiddleware
