import { AsyncLocalStorage } from 'node:async_hooks'

const createContext = () => {
    const storage = new AsyncLocalStorage()

    return {
        run: (store, callBack) => storage.run(store, callBack),
        get: (key) => storage.getStore()?.[key],
        getStore: () => storage.getStore()
    }
}

export default createContext