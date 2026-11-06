// Access tokens are short-lived: they cannot be revoked, only outlived.
export const DEFAULT_JWT_ACCESS_TTL_S = 15 * 60;
// Refresh tokens can be revoked, so they may live long. Each use replaces the token.
export const DEFAULT_JWT_REFRESH_TTL_S = 30 * 86_400;

export const JWT_SECRET_MIN_LENGTH = 32;
// HS256 only. Verification pins it, so a token signed with another algorithm (or "none") is refused.
export const JWT_ALGORITHM = 'HS256';
export const TOKEN_TYPE = 'Bearer';
