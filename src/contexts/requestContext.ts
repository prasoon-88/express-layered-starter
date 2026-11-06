import { createContext } from './createContext.ts';

type RequestStore = {
  requestId: string;
};

const context = createContext<RequestStore>();

// `satisfies` checks every value is a real RequestStore key without widening it to `string`.
const STORE_KEYS = Object.freeze({
  REQUEST_ID: 'requestId',
} satisfies Record<string, keyof RequestStore>);

export const requestContext = {
  STORE_KEYS,

  run: context.run,

  getRequestId: () => context.get(STORE_KEYS.REQUEST_ID),
};
