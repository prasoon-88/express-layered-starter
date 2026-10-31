import createContext from './createContext.ts';

interface RequestStore {
  requestId: string;
}

const context = createContext<RequestStore>();

// `satisfies` checks every value is a real RequestStore key without widening it to `string`.
const STORE_KEYS = Object.freeze({
  REQUEST_ID: 'requestId',
} satisfies Record<string, keyof RequestStore>);

const requestContext = {
  STORE_KEYS,

  run: context.run,

  getRequestId: () => context.get(STORE_KEYS.REQUEST_ID),
};

export default requestContext;
