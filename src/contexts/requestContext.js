import createContext from './createContext.js';

const context = createContext();

const STORE_KEYS = Object.freeze({
  REQUEST_ID: 'requestId',
});

const requestContext = {
  STORE_KEYS,

  run: context.run,

  getRequestId: () => context.get(STORE_KEYS.REQUEST_ID),
};

export default requestContext;
