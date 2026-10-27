import ERROR_CODES from "./errorCodes.constant.js";

const APP_ERROR_CODES = Object.freeze({
  ...ERROR_CODES,
  EMAIL_TAKEN: "EMAIL_TAKEN",
  USER_NOT_FOUND: "USER_NOT_FOUND",
});

export default APP_ERROR_CODES;