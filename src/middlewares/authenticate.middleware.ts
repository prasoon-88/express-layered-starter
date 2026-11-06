import type { RequestHandler } from 'express';
import type { AccessTokens } from '#lib/auth/accessToken';
import { authUserSchema } from '#schemas/user.schema';
import { UnauthorizedError } from '#errors';
import { APP_ERROR_CODES } from '#constants/error/appErrorCodes.constant';
import { HTTP_HEADERS } from '#constants/http/httpHeaders.constant';
import { REGEX } from '#constants/regex.constant';

type AuthenticateDeps = {
  accessTokens: Pick<AccessTokens, 'verify'>;
};

// RFC 6750: a 401 names the scheme, and says why when credentials were sent but refused.
const CHALLENGE = 'Bearer';
const INVALID_TOKEN_CHALLENGE = 'Bearer error="invalid_token"';

/** Verifies the Bearer access token and sets `req.user`. The `authenticated` and `roles` strategies run it. */
export const createAuthenticateMiddleware = ({
  accessTokens,
}: AuthenticateDeps): RequestHandler => {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (header === undefined) {
      res.set(HTTP_HEADERS.WWW_AUTHENTICATE, CHALLENGE);
      return next(new UnauthorizedError('Authentication required'));
    }

    const refuse = (err: unknown) => {
      res.set(HTTP_HEADERS.WWW_AUTHENTICATE, INVALID_TOKEN_CHALLENGE);
      next(err);
    };

    const token = REGEX.BEARER.exec(header)?.[1];
    if (!token)
      return refuse(new UnauthorizedError('Invalid token', APP_ERROR_CODES.TOKEN_INVALID));

    let claims;
    try {
      claims = accessTokens.verify(token);
    } catch (err) {
      return refuse(err);
    }

    // Signed by us, but checked anyway: a token issued before a role was removed must not pass.
    const user = authUserSchema.safeParse({
      id: claims.sub,
      email: claims.email,
      role: claims.role,
    });
    if (!user.success)
      return refuse(new UnauthorizedError('Invalid token', APP_ERROR_CODES.TOKEN_INVALID));

    req.user = user.data;
    next();
  };
};
