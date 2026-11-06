import { AsyncLocalStorage } from 'node:async_hooks';

// TStore is the shape of what one context holds, e.g. { requestId: string }.
export const createContext = <TStore extends object>() => {
  const storage = new AsyncLocalStorage<TStore>();

  return {
    run: <R>(store: TStore, callBack: () => R): R => storage.run(store, callBack),
    get: <K extends keyof TStore>(key: K): TStore[K] | undefined => storage.getStore()?.[key],
    getStore: (): TStore | undefined => storage.getStore(),
  };
};
