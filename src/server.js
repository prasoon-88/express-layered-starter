import app from './app.js'
import ENV_CONSTANTS from '#constants/env.constant.js'
import { getLogger } from '#lib/logger/index.js'
import { registerProcessHandler } from '#lib/lifecycle/index.js'

const logger = getLogger('server')

const server = app.listen(ENV_CONSTANTS.PORT,()=>{
    logger.info({ port: ENV_CONSTANTS.PORT, env: ENV_CONSTANTS.ENV }, 'server started')    
})

registerProcessHandler({
    server
})