import { describe, expect, it } from 'vitest';
import {
  decodeRecoveryCode,
  encodeRecoveryCode,
  generateInviteCode,
  hashInviteCode,
  recoveryEmail,
  secretFromBase32,
  secretToBase32,
} from './recovery.ts';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const USER_ID = '3f2b8c1e-9a4d-4e7f-8b6a-0c5d1e2f3a4b';
const SECRET = Uint8Array.from([1, 2, 3, 250, 251, 252, 0, 255, 128, 77]);

describe('recovery code', () => {
  it('round-trips user id and secret', () => {
    const code = encodeRecoveryCode(USER_ID, SECRET);
    const decoded = decodeRecoveryCode(code);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe(USER_ID);
    expect(decoded!.secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
  });

  it('is grouped in fours with hyphens, Crockford alphabet only', () => {
    const code = encodeRecoveryCode(USER_ID, SECRET);
    const groups = code.split('-');
    expect(groups.slice(0, -1).every((g) => g.length === 4)).toBe(true);
    expect(groups[groups.length - 1].length).toBeLessThanOrEqual(4);
    expect([...code.replaceAll('-', '')].every((c) => ALPHABET.includes(c))).toBe(true);
  });

  it('gives different secrets for different secret bytes', () => {
    const a = decodeRecoveryCode(encodeRecoveryCode(USER_ID, SECRET))!;
    const b = decodeRecoveryCode(encodeRecoveryCode(USER_ID, new Uint8Array(10)))!;
    expect(a.secret).not.toBe(b.secret);
    expect(b.secret).toBe('0000000000000000');
  });

  it('accepts lowercase, missing hyphens and spaces', () => {
    const code = encodeRecoveryCode(USER_ID, SECRET);
    const expected = decodeRecoveryCode(code);
    expect(decodeRecoveryCode(code.toLowerCase())).toEqual(expected);
    expect(decodeRecoveryCode(code.replaceAll('-', ''))).toEqual(expected);
    expect(decodeRecoveryCode(` ${code.replaceAll('-', ' ')} `)).toEqual(expected);
  });

  it('returns null for garbage', () => {
    expect(decodeRecoveryCode('')).toBeNull();
    expect(decodeRecoveryCode('not a code')).toBeNull();
    expect(decodeRecoveryCode('!!!!-????')).toBeNull();
    const code = encodeRecoveryCode(USER_ID, SECRET);
    expect(decodeRecoveryCode(code.slice(0, -2))).toBeNull();
    expect(decodeRecoveryCode(code + 'AAAA')).toBeNull();
    expect(decodeRecoveryCode(code.replace(/^./, 'U'))).toBeNull();
  });

  it('rejects wrong-length secrets', () => {
    expect(() => encodeRecoveryCode(USER_ID, new Uint8Array(9))).toThrow();
    expect(() => encodeRecoveryCode('not-a-uuid', SECRET)).toThrow();
  });
});

describe('recoveryEmail', () => {
  it('is the synthetic address for the user', () => {
    expect(recoveryEmail(USER_ID)).toBe(`${USER_ID}@users.music-hitchhiking.invalid`);
  });
});

describe('invite codes', () => {
  it('generates 10 Crockford characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(10);
      expect([...code].every((c) => ALPHABET.includes(c))).toBe(true);
    }
  });

  it('does not repeat', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateInviteCode()));
    expect(codes.size).toBe(100);
  });

  it('hashes case-, space- and hyphen-insensitively', async () => {
    expect(await hashInviteCode('ab-cd 12')).toBe(await hashInviteCode('ABCD12'));
    expect(await hashInviteCode('ABCD12')).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashInviteCode('ABCD12')).not.toBe(await hashInviteCode('ABCD13'));
  });
});

describe('secret helpers', () => {
  it('secretToBase32 is the secret the recovery code carries', () => {
    expect(secretToBase32(SECRET)).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(decodeRecoveryCode(encodeRecoveryCode(USER_ID, SECRET))!.secret).toBe(secretToBase32(SECRET));
  });

  it('round-trips through secretFromBase32', () => {
    expect([...secretFromBase32(secretToBase32(SECRET))!]).toEqual([...SECRET]);
  });

  it('refuses malformed secrets', () => {
    for (const bad of ['', 'ABC', secretToBase32(SECRET).toLowerCase(), `${secretToBase32(SECRET)}0`, 'UUUUUUUUUUUUUUUU', 'I'.repeat(16)]) {
      expect(secretFromBase32(bad)).toBeNull();
    }
    expect(() => secretToBase32(new Uint8Array(9))).toThrow();
  });
});
