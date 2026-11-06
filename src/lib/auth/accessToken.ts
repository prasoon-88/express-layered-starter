import jwt from 'jsonwebtoken';
import { JWT_ALGORITHM, JWT_SECRET_MIN_LENGTH } from '#constants/auth.constant';
import { MS_PER_SECOND } from '#constants/time.constant';

// Instances behind a load balancer never share a perfectly synced clock.
const CLOCK_TOLERANCE_S = 5;

export type AccessClaims = {
  sub: string;
  email: string;
  role: string;
};

type AccessTokenOptions = {
  secret: string;
  issuer: string;
  audience: string;
  ttlS: number;
  /** Milliseconds since the epoch. Injectable so expiry is testable without waiting. */
  now?: () => number;
};

export const createAccessTokens = ({
  secret,
  issuer,
  audience,
  ttlS,
  now = Date.now,
}: AccessTokenOptions) => {
  if (secret.length < JWT_SECRET_MIN_LENGTH)
    throw new RangeError(`The JWT secret must be at least ${JWT_SECRET_MIN_LENGTH} characters`);
  if (!Number.isInteger(ttlS) || ttlS <= 0)
    throw new RangeError('The access token ttl must be a positive whole number of seconds');

  const seconds = () => Math.floor(now() / MS_PER_SECOND);

  const sign = ({ sub, email, role }: AccessClaims) => ({
    token: jwt.sign({ email, role, iat: seconds() }, secret, {
      algorithm: JWT_ALGORITHM,
      subject: sub,
      issuer,
      audience,
      expiresIn: ttlS,
    }),
    expiresIn: ttlS,
  });

  // Throws jsonwebtoken's own errors; the JWT converter turns them into 401 responses.
  // The claims are only signed, not checked for shape: `unknown`, so the caller must validate them.
  const verify = (token: string): Record<string, unknown> => {
    const payload = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM],
      issuer,
      audience,
      clockTimestamp: seconds(),
      clockTolerance: CLOCK_TOLERANCE_S,
    });
    if (typeof payload === 'string')
      throw new jwt.JsonWebTokenError('jwt payload is not an object');
    return payload;
  };

  return { sign, verify };
};

export type AccessTokens = ReturnType<typeof createAccessTokens>;
