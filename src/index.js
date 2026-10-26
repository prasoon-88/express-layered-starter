import express from 'express'
import helmet from 'helmet'
import PATHS from '#constants/path.constant.js'
import ENV_CONSTANTS from '#constants/env.constant.js'
import ROUTES from '#routes/index.js'

const app = express()

// Application settings config
app.set('view engine','ejs')
app.set('views', PATHS.VIEWS.path)

// Middlewares
app.use(helmet())

// Routes
app.use('/', ROUTES)

app.listen(ENV_CONSTANTS.PORT,()=>{
    console.log(`[SERVER RUNNING] | Server started on port ${ENV_CONSTANTS.PORT}`)
})