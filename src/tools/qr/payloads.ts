/**
 * Structured QR payload builders.
 *
 * The formats are the useful part — a QR code is just a string encoder, but
 * "what exact string makes a phone join a WiFi network" is the bit nobody
 * remembers. Escaping rules differ per format and getting them wrong produces
 * a code that scans but does nothing.
 */

export type PayloadKind = 'text' | 'url' | 'wifi' | 'vcard' | 'event' | 'email' | 'sms' | 'tel' | 'geo' | 'totp';

export const PAYLOAD_KINDS: readonly PayloadKind[] = [
  'text', 'url', 'wifi', 'vcard', 'event', 'email', 'sms', 'tel', 'geo', 'totp',
];

export const PAYLOAD_NAMES: Record<PayloadKind, string> = {
  text: 'Text',
  url: 'URL',
  wifi: 'WiFi',
  vcard: 'Contact',
  event: 'Calendar',
  email: 'Email',
  sms: 'SMS',
  tel: 'Phone',
  geo: 'Location',
  totp: 'TOTP (2FA)',
};

/** WIFI: and MECARD: use backslash escaping for these delimiters. */
function escapeWifi(value: string): string {
  return value.replace(/([\\;,":])/g, '\\$1');
}

/** vCard/iCalendar escape commas, semicolons, backslashes and newlines. */
function escapeVcard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icalDate(value: string): string {
  // Accepts an <input type="datetime-local"> value and emits a UTC iCal stamp.
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export interface WifiFields {
  ssid: string;
  password: string;
  security: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
}

export interface VcardFields {
  firstName: string;
  lastName: string;
  organisation: string;
  title: string;
  phone: string;
  email: string;
  url: string;
}

export interface EventFields {
  summary: string;
  location: string;
  start: string;
  end: string;
}

export interface TotpFields {
  issuer: string;
  account: string;
  secret: string;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: 6 | 8;
  period: number;
}

export function buildWifi(f: WifiFields): string {
  const parts = [`S:${escapeWifi(f.ssid)}`];
  parts.push(`T:${f.security}`);
  if (f.security !== 'nopass') parts.push(`P:${escapeWifi(f.password)}`);
  if (f.hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

export function buildVcard(f: VcardFields): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVcard(f.lastName)};${escapeVcard(f.firstName)};;;`,
    `FN:${escapeVcard(`${f.firstName} ${f.lastName}`.trim())}`,
  ];
  if (f.organisation) lines.push(`ORG:${escapeVcard(f.organisation)}`);
  if (f.title) lines.push(`TITLE:${escapeVcard(f.title)}`);
  if (f.phone) lines.push(`TEL;TYPE=CELL:${escapeVcard(f.phone)}`);
  if (f.email) lines.push(`EMAIL:${escapeVcard(f.email)}`);
  if (f.url) lines.push(`URL:${escapeVcard(f.url)}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

export function buildEvent(f: EventFields): string {
  const lines = ['BEGIN:VEVENT', `SUMMARY:${escapeVcard(f.summary)}`];
  if (f.location) lines.push(`LOCATION:${escapeVcard(f.location)}`);
  const start = icalDate(f.start);
  const end = icalDate(f.end);
  if (start) lines.push(`DTSTART:${start}`);
  if (end) lines.push(`DTEND:${end}`);
  lines.push('END:VEVENT');
  return lines.join('\n');
}

export function buildEmail(to: string, subject: string, body: string): string {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const query = params.toString();
  return `mailto:${to}${query ? `?${query}` : ''}`;
}

export function buildSms(number: string, message: string): string {
  return message ? `SMSTO:${number}:${message}` : `SMSTO:${number}`;
}

export function buildGeo(lat: string, lon: string): string {
  return `geo:${lat},${lon}`;
}

/**
 * otpauth:// — what an authenticator app expects. The secret must be base32
 * without padding; anything else silently produces wrong codes.
 */
export function buildTotp(f: TotpFields): string {
  const label = f.issuer ? `${f.issuer}:${f.account}` : f.account;
  const params = new URLSearchParams({
    // Falls back to the secret as typed when the padding is misplaced, so the
    // code carries what the user entered rather than a key nobody asked for.
    // `validateBase32` is what tells them about it.
    secret: normaliseBase32(f.secret) ?? f.secret.replace(/\s+/g, '').toUpperCase(),
    algorithm: f.algorithm,
    digits: String(f.digits),
    period: String(f.period),
  });
  if (f.issuer) params.set('issuer', f.issuer);
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Strips whitespace and legal trailing padding from a base32 secret.
 *
 * Padding only ever appears at the end of base32. Removing `=` wherever it
 * appeared meant `JBSW=Y3DP` was accepted and encoded as `JBSWY3DP` — a
 * different key, so an authenticator provisioned from the QR code would never
 * agree with the server, with nothing on screen to suggest why. Returns null
 * when a `=` sits anywhere else.
 */
export function normaliseBase32(secret: string): string | null {
  const compact = secret.replace(/\s+/g, '').toUpperCase();
  const body = compact.replace(/=+$/, '');
  return body.includes('=') ? null : body;
}

/** Validates a base32 TOTP secret, since a bad one fails silently in the app. */
export function validateBase32(secret: string): string | null {
  const cleaned = normaliseBase32(secret);
  if (cleaned === null) {
    return 'Base32 padding (“=”) may only appear at the end of the secret.';
  }
  if (!cleaned) return 'Secret is required.';
  for (const ch of cleaned) {
    if (!BASE32.includes(ch)) {
      return `“${ch}” is not valid base32. Use A–Z and 2–7 only.`;
    }
  }
  if (cleaned.length < 16) return 'Secret is shorter than 16 characters — most issuers use 32.';
  return null;
}

/** Generates a random base32 secret for testing against a 2FA flow. */
export function randomBase32Secret(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => BASE32[b % 32]).join('');
}
