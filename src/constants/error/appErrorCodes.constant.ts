import ERROR_CODES from './errorCodes.constant.ts';

const APP_ERROR_CODES = Object.freeze({
  ...ERROR_CODES,
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
});

export type AppErrorCode = (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES];

export default APP_ERROR_CODES;
