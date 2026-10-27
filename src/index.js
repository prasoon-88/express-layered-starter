import express from 'express'
import PATHS from '#constants/path.constant.js'
import ENV_CONSTANTS from '#constants/env.constant.js'
import ROUTES from '#routes/index.js'
import notFoundMiddleware from '#middlewares/notFound.middleware.js'
import errorHandlerMiddleware from '#middlewares/error.middleware.js'

const app = express()

// Application settings config
app.set('view engine','ejs')
app.set('views', PATHS.VIEWS.path)

// Pre Middlewares

// Routes
app.use('/', ROUTES)

// Post Middlewares
app.use(notFoundMiddleware)
app.use(errorHandlerMiddleware)

app.listen(ENV_CONSTANTS.PORT,()=>{
    console.log(`[SERVER RUNNING] | Server started on port ${ENV_CONSTANTS.PORT}`)
})