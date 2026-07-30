import { describe, it, expect } from 'vitest';
import { buildEmail, buildEvent, buildGeo, buildSms, buildTotp, buildVcard, buildWifi, normaliseBase32, randomBase32Secret, validateBase32 } from './payloads.ts';

describe('buildWifi', () => {
  it('produces the canonical WIFI: string', () => {
    expect(buildWifi({ ssid: 'MyNet', password: 'hunter2', security: 'WPA', hidden: false })).toBe(
      'WIFI:S:MyNet;T:WPA;P:hunter2;;',
    );
  });

  it('omits the password for open networks', () => {
    const out = buildWifi({ ssid: 'Free', password: 'ignored', security: 'nopass', hidden: false });
    expect(out).toBe('WIFI:S:Free;T:nopass;;');
    expect(out).not.toContain('ignored');
  });

  it('flags hidden networks', () => {
    expect(buildWifi({ ssid: 'x', password: 'y', security: 'WPA', hidden: true })).toContain('H:true');
  });

  it('escapes the delimiter characters', () => {
    // An SSID containing ; or : would otherwise truncate the payload and the
    // resulting code would scan but fail to connect.
    const out = buildWifi({
      ssid: 'Cafe;Free:Wifi,2',
      password: 'a"b\\c',
      security: 'WPA',
      hidden: false,
    });
    expect(out).toContain('S:Cafe\\;Free\\:Wifi\\,2');
    expect(out).toContain('P:a\\"b\\\\c');
  });
});

describe('buildVcard', () => {
  const base = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    organisation: '',
    title: '',
    phone: '',
    email: '',
    url: '',
  };

  it('produces a well-formed vCard', () => {
    const out = buildVcard(base);
    expect(out.startsWith('BEGIN:VCARD')).toBe(true);
    expect(out.endsWith('END:VCARD')).toBe(true);
    expect(out).toContain('VERSION:3.0');
    expect(out).toContain('N:Lovelace;Ada;;;');
    expect(out).toContain('FN:Ada Lovelace');
  });

  it('omits empty optional fields rather than emitting blank properties', () => {
    const out = buildVcard(base);
    expect(out).not.toContain('ORG:');
    expect(out).not.toContain('TEL');
    expect(out).not.toContain('EMAIL:');
  });

  it('escapes commas, semicolons and newlines', () => {
    const out = buildVcard({ ...base, organisation: 'Acme, Inc; Ltd\nSecond' });
    expect(out).toContain('ORG:Acme\\, Inc\\; Ltd\\nSecond');
  });
});

describe('buildEvent', () => {
  it('emits UTC iCal timestamps', () => {
    const out = buildEvent({
      summary: 'Standup',
      location: '',
      start: '2026-03-01T09:00:00Z',
      end: '2026-03-01T09:15:00Z',
    });
    expect(out).toContain('DTSTART:20260301T090000Z');
    expect(out).toContain('DTEND:20260301T091500Z');
    expect(out).toContain('SUMMARY:Standup');
  });

  it('skips unparseable dates instead of emitting garbage', () => {
    const out = buildEvent({ summary: 'x', location: '', start: 'nonsense', end: '' });
    expect(out).not.toContain('DTSTART');
    expect(out).toContain('BEGIN:VEVENT');
  });
});

describe('simple schemes', () => {
  it('builds mailto with encoded query parameters', () => {
    const out = buildEmail('a@b.com', 'Hello there', 'Line one & two');
    expect(out.startsWith('mailto:a@b.com?')).toBe(true);
    expect(out).toContain('subject=Hello+there');
    expect(out).toContain('body=Line+one+%26+two');
  });

  it('omits the query when there is nothing to add', () => {
    expect(buildEmail('a@b.com', '', '')).toBe('mailto:a@b.com');
  });

  it('builds SMSTO with and without a message', () => {
    expect(buildSms('+441234567890', 'hi')).toBe('SMSTO:+441234567890:hi');
    expect(buildSms('+441234567890', '')).toBe('SMSTO:+441234567890');
  });

  it('builds geo URIs', () => {
    expect(buildGeo('51.5074', '-0.1278')).toBe('geo:51.5074,-0.1278');
  });
});

describe('buildTotp', () => {
  const base = {
    issuer: 'Example',
    account: 'ada@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1' as const,
    digits: 6 as const,
    period: 30,
  };

  it('produces a valid otpauth URI', () => {
    const out = buildTotp(base);
    expect(out.startsWith('otpauth://totp/')).toBe(true);
    const url = new URL(out);
    expect(url.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(url.searchParams.get('issuer')).toBe('Example');
    expect(url.searchParams.get('digits')).toBe('6');
    expect(url.searchParams.get('period')).toBe('30');
  });

  it('encodes the issuer:account label', () => {
    expect(buildTotp(base)).toContain(encodeURIComponent('Example:ada@example.com'));
  });

  it('normalises the secret to unpadded uppercase base32', () => {
    const out = buildTotp({ ...base, secret: 'jbswy3dp ehpk3pxp==' });
    expect(new URL(out).searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
  });
});

describe('validateBase32', () => {
  it('accepts a valid secret', () => {
    expect(validateBase32('JBSWY3DPEHPK3PXP')).toBeNull();
    expect(validateBase32('jbswy3dp ehpk3pxp')).toBeNull();
  });

  it('rejects characters outside the base32 alphabet', () => {
    // 0, 1, 8 and 9 are excluded from base32 precisely because they look like
    // O, I and B — a typo here yields wrong codes with no error.
    expect(validateBase32('JBSW0189')).toMatch(/not valid base32/);
    expect(validateBase32('ABC!DEF')).toMatch(/not valid base32/);
  });

  it('rejects an empty secret', () => {
    expect(validateBase32('')).toMatch(/required/i);
  });

  it('warns on suspiciously short secrets', () => {
    expect(validateBase32('JBSWY3DP')).toMatch(/shorter/i);
  });
});

describe('randomBase32Secret', () => {
  it('produces a secret that passes its own validation', () => {
    for (let i = 0; i < 20; i++) {
      const secret = randomBase32Secret();
      expect(secret).toHaveLength(32);
      expect(validateBase32(secret), secret).toBeNull();
    }
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomBase32Secret()));
    expect(seen.size).toBe(50);
  });
});

/**
 * Regression: `=` was stripped wherever it appeared, so a secret with interior
 * padding was accepted and encoded as a different key — an authenticator
 * provisioned from the code would never match the server.
 */
describe('base32 padding placement', () => {
  it('accepts legal trailing padding', () => {
    expect(normaliseBase32('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
    expect(normaliseBase32('JBSWY3DPEHPK3PX=')).toBe('JBSWY3DPEHPK3PX');
    expect(normaliseBase32('JBSWY3DP======')).toBe('JBSWY3DP');
  });

  it('rejects padding anywhere else', () => {
    expect(normaliseBase32('JBSW=Y3DP')).toBeNull();
    expect(normaliseBase32('=JBSWY3DP')).toBeNull();
    expect(normaliseBase32('JB=SW==Y3DP===')).toBeNull();
  });

  it('normalises whitespace and case as before', () => {
    expect(normaliseBase32(' jbswy3dp ehpk3pxp ')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('reports misplaced padding rather than silently repairing it', () => {
    expect(validateBase32('JBSW=Y3DPEHPK3PXP')).toMatch(/only appear at the end/);
  });

  it('never encodes a key the user did not type', () => {
    const url = buildTotp({
      issuer: 'i', account: 'a', secret: 'JBSW=Y3DPEHPK3PXP',
      digits: 6, period: 30, algorithm: 'SHA1',
    } as never);
    const encoded = new URL(url).searchParams.get('secret');
    // Must not have become the shorter, different key JBSWY3DPEHPK3PXP.
    expect(encoded).toBe('JBSW=Y3DPEHPK3PXP');
  });
});
