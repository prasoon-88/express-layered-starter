const HIDDEN_FIELDS = [
    "pid", "hostname", "service", "env", "requestId", "module", "type", "method", "path", "status",
    "durationMs", "contentLength", "ip", "userAgent", "errorCode", "slow", "aborted",
]

const CUSTOMIZE_COLOR = {
    trace: 'gray',
    debug: 'blue',
    info: 'green',
    warn: 'yellow',
    error: 'red',
    fatal: 'bgRed'
}

const getPaint = (statusCode, colors) => {
    if(statusCode >= 500) return colors.red 
    if(statusCode >= 400) return colors.yellow 
    if(statusCode >= 300) return colors.cyan
    return colors.green 
}

const shortId = (id) => String(id).slice(0, 8)

const messageFormat = (log, messageKey, levelLabel, { colors }) => {
    const id = log.requestId ? colors.gray(`[${shortId(log.requestId)}]`) : ''

    switch(log.type){
        case 'http':
            const paint = getPaint(log.status, colors)
            const timing = log.slow ? colors.yellow : colors.gray
            const flags = [
                log.aborted && colors.red("ABORTED"),
                log.errorCode && colors.red(log.errorCode)
            ].filter(Boolean).join(" ")
            return `${id} ${colors.bold(log.method)} ${log.path} ${paint(log.status)} ${timing(`${log.durationMs}ms`)}${flags ? " " + flags : ""}`
        default:
            const mod = log.module ? colors.magenta(`(${log.module}) `) : ""
            return `${id} ${mod} ${log[messageKey]}`

    }
}

export const createPrettyStream = async({destination = 1} = {})=>{
    const { default: pretty } = await import('pino-pretty')

    return pretty({
        colorize: true,
        sync: true,
        destination,
        translateTime: "HH:MM:ss.l",
        ignore: HIDDEN_FIELDS.join(','),
        customColors: CUSTOMIZE_COLOR,
        messageFormat
    })
}