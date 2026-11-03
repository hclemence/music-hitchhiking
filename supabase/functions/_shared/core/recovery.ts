const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_BYTES = 10;
const USER_BYTES = 16;
const CODE_CHARS = Math.ceil(((USER_BYTES + SECRET_BYTES) * 8) / 5); // 42

/** Crockford base32 (no padding) of arbitrary bytes. */
function base32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Inverse of `base32`; null on a character outside the alphabet or non-zero trailing bits. */
function unbase32(text: string): Uint8Array | null {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 255);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  if (buffer !== 0) return null;
  return Uint8Array.from(out);
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll('-', '');
  const bytes = new Uint8Array(USER_BYTES);
  for (let i = 0; i < USER_BYTES; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Crockford base32 of the 16 uuid bytes + 10 secret bytes, grouped in fours with hyphens. */
export function encodeRecoveryCode(userId: string, secret: Uint8Array): string {
  if (!UUID_RE.test(userId)) throw new Error('userId must be a uuid');
  if (secret.length !== SECRET_BYTES) throw new Error(`secret must be ${SECRET_BYTES} bytes`);
  const bytes = new Uint8Array(USER_BYTES + SECRET_BYTES);
  bytes.set(uuidToBytes(userId), 0);
  bytes.set(secret, USER_BYTES);
  return base32(bytes).match(/.{1,4}/g)!.join('-');
}

/**
 * Parses a recovery code, ignoring case, spaces and hyphens (and reading I/L as 1, O as 0).
 * `secret` is the base32 form of the secret bytes — the password for the recovery account.
 */
export function decodeRecoveryCode(code: string): { userId: string; secret: string } | null {
  const text = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (text.length !== CODE_CHARS) return null;
  const bytes = unbase32(text);
  if (!bytes || bytes.length !== USER_BYTES + SECRET_BYTES) return null;
  return {
    userId: bytesToUuid(bytes.subarray(0, USER_BYTES)),
    secret: base32(bytes.subarray(USER_BYTES)),
  };
}

/** The recovery password for 10 secret bytes: 16 Crockford base32 characters. */
export function secretToBase32(secret: Uint8Array): string {
  if (secret.length !== SECRET_BYTES) throw new Error(`secret must be ${SECRET_BYTES} bytes`);
  return base32(secret);
}

/** Inverse of `secretToBase32` (canonical upper case only); null if `text` is not a valid secret. */
export function secretFromBase32(text: string): Uint8Array | null {
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(text)) return null;
  return unbase32(text);
}

/** Synthetic sign-in address for a recoverable account. */
export function recoveryEmail(userId: string): string {
  return `${userId}@users.music-hitchhiking.invalid`;
}

/** 10 Crockford base32 characters (256 is a multiple of 32, so masking a byte is unbiased). */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b & 31]).join('');
}

/** SHA-256 hex of the code, uppercased with spaces and hyphens removed. */
export async function hashInviteCode(code: string): Promise<string> {
  const normalised = code.toUpperCase().replace(/[\s-]/g, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
