import { lifecycleConfig } from '#config/lifecycle.config.js'
import { getLogger } from '#lib/logger/index.js'
import { sleep } from '#utils/sleep.util.js'
import lifecycleState from './state.js'

const toError = (value) => value instanceof Error ? value : new Error(String(value))

export const registerProcessHandler = (
    {
        server,
        hooks= [],
        logger= getLogger("lifecycle"),
        timeoutMs= lifecycleConfig.shutdownTimeoutMs,
        drainDelayMs= lifecycleConfig.drainDelayMs,
        proc= process,
        exit= (code) => process.exit(code)
    } = {}
) => {
    if (!server) throw new TypeError('registerProcessHandler: `server` is required')
    if (!(drainDelayMs < timeoutMs)) throw new RangeError(`drainDelayMs (${drainDelayMs}) must be less than timeoutMs (${timeoutMs})`)

    let isCrashed = false

    const closeServer = () => new Promise((resolve, reject)=>{
        server.close((err)=>{
            if(err && err.code !== 'ERR_SERVER_NOT_RUNNING') return reject(err)
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

    const shutdown = async(reason, exitCode, {drain = false} = {}) => {
        if(lifecycleState.isShuttingDown()) return
        lifecycleState.markShutdown()
        
        const timer = setTimeout(()=>{
            logger.error({ reason, timeoutMs }, "graceful shutdown timed out, forcing exit")
            server.closeAllConnections?.()
            exit(1)
        }, timeoutMs)

        try{
            if(drain && drainDelayMs) await sleep(drainDelayMs)
            await closeServer()
            if(await runHooks()) exitCode = 1
        }catch(err){
            logger.error({ err }, 'error during shutdown')
            exitCode = 1
        }

        clearTimeout(timer)
        exit(isCrashed? 1 :exitCode)
    }

    const onSignal = (signal) => {
        if(lifecycleState.isShuttingDown()){
            logger.warn({ signal }, 'second signal received, forcing exit')
            return exit(1)
        }
        logger.info({ signal }, 'signal received, shutting down')
        shutdown(signal, 0, { drain: true }).catch((err)=>{
            logger.fatal({ err }, 'shutdown failed')
            exit(1)
        })
    }

    const onCrash = (label) => (value) => {
        const err = toError(value)
        if (lifecycleState.isShuttingDown()) {
            isCrashed = true
            logger.error({ err }, `${label} during shutdown`)
            return
        }
        logger.fatal({err}, label)
        shutdown(label, 1).catch((err)=>{
            logger.fatal({ err }, 'shutdown failed')
            exit(1)
        })
    }

    server.on('error', onCrash('server error'))
    proc.on('SIGTERM', onSignal)
    proc.on('SIGINT', onSignal)
    proc.on('unhandledRejection', onCrash("unhandled rejection"))
    proc.on('uncaughtException', onCrash("uncaught exception"))

    return { shutdown }
}