import { lifecycleConfig } from '#config/lifecycle.config.js'
import { getLogger } from '#lib/logger/index.js'

const toError = (value) => value instanceof Error ? value : new Error(String(value))

export const registerProcessHandler = (
    {
        server,
        hooks= [],
        logger= getLogger("lifecycle"),
        timeoutMs= lifecycleConfig.shutdownTimeoutMs,
        proc= process,
        exit= (code) => process.exit(code)
    } = {}
) => {
    if (!server) throw new TypeError('registerProcessHandler: `server` is required')

    let shuttingDown = false

    const closeServer = () => new Promise((resolve, reject)=>{
        server.close((err)=>{
            if(err && err.code != 'ERR_SERVER_NOT_RUNNING') return reject(err)
            resolve()
        })
        server.closeIdleConnections?.()
    })

    const runHooks = async () => {
        let failed = false

        for(const hook of hooks){
            try{
                await hook()
            }catch(err){
                failed = true
                logger.error({ err, hook: hook.name }, "shutdown hook failed")
            }
        }
        return failed
    }

    const shutdown = async(reason, exitCode) => {
        if(shuttingDown) return
        shuttingDown = true
        
        const timer = setTimeout(()=>{
            logger.error({ reason, timeoutMs }, "graceful shutdown timed out, forcing exit")
            server.closeAllConnections?.()
            exit(1)
        }, timeoutMs)

        try{
            await closeServer()
            if(await runHooks()) exitCode = 1
        }catch(err){
            logger.error({ err }, 'error during shutdown')
            exitCode = 1
        }

        clearTimeout(timer)
        exit(exitCode)
    }

    const onSignal = (signal) => {
        if(shuttingDown){
            logger.warn({ signal }, 'second signal received, forcing exit')
            return exit(1)
        }
        logger.info({ signal }, 'signal received, shutting down')
        shutdown(signal, 0)
    }

    const onCrash = (label) => (value) => {
        const err = toError(value)
        if (shuttingDown) {
            logger.error({ err }, `${label} during shutdown`)
            return
        }
        logger.fatal({err}, label)
        shutdown(label, 1)
    }

    server.on('error', onCrash('server error'))
    proc.on('SIGTERM', onSignal)
    proc.on('SIGINT', onSignal)
    proc.on('unhandledRejection', onCrash("unhandled rejection"))
    proc.on('uncaughtException', onCrash("uncaught exception"))

    return { shutdown, isShuttingDown: () => shuttingDown }
}