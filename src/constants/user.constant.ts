// `as const` keeps the literal values, so UserRole is 'NORMAL' | 'ADMIN' (an enum without `enum`).
export const USER_ROLES = ['NORMAL', 'ADMIN'] as const;

export type UserRole = (typeof USER_ROLES)[number];

const USER_CONSTANTS = Object.freeze({
  USER_ROLES,
});

export default USER_CONSTANTS;
