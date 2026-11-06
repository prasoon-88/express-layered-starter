import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { concatenateStrings } from './concateStrings.ts';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

// Stored as `<salt hex>:<key hex>`. scrypt uses Node's default cost parameters.
export const hashPassword = async (password: string) => {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt, KEY_BYTES);
  return concatenateStrings([salt.toString('hex'), key.toString('hex')], ':');
};

export const verifyPassword = async (password: string, stored: string) => {
  const [saltHex, keyHex, ...extra] = stored.split(':');
  if (!saltHex || !keyHex || extra.length > 0) return false;

  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== KEY_BYTES) return false;

  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEY_BYTES);
  return timingSafeEqual(actual, expected);
};
