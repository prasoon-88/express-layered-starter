import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '../..')

const resolveFolder  = (folderName, ...parents) => Object.freeze({
    name: folderName,
    path: resolve(ROOT, ...parents, folderName)
})

const PATHS = Object.freeze({
    ROOT,
    SRC: resolveFolder('src'),
    UPLOAD: resolveFolder('upload'),
    PUBLIC: resolveFolder('public'),
    VIEWS: resolveFolder('views', 'src')
})

export default PATHS