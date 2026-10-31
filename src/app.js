import express from 'express'
import PATHS from '#constants/path.constant.js'
import ROUTES from '#routes/index.js'
import notFoundMiddleware from '#middlewares/notFound.middleware.js'
import errorHandlerMiddleware from '#middlewares/error.middleware.js'
import requestIdMiddleware from '#middlewares/requestId.middleware.js'
import httpLoggerMiddleware from '#middlewares/httpLogger.middleware.js'

const app = express()

// Application settings config
app.set('view engine','ejs')
app.set('views', PATHS.VIEWS.path)

// Pre Middlewares
app.use(requestIdMiddleware())
app.use(httpLoggerMiddleware())

// Routes
app.use('/', ROUTES)

// Post Middlewares
app.use(notFoundMiddleware)
app.use(errorHandlerMiddleware)

export default app