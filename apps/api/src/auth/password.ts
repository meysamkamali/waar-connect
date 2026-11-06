// Password hashing with scrypt from node:crypto; no native dependency.
// Stored form: scrypt$N$r$p$<salt base64url>$<key base64url>
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, keyText] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(keyText, 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;
  const key = await scrypt(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
