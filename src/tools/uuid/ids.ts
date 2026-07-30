import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';
import { monotonicFactory } from 'ulid';
import { nanoid } from 'nanoid';

/**
 * Plain ulid() draws a fresh random suffix per call, so IDs minted inside the
 * same millisecond do not sort in generation order — which defeats the reason
 * to pick ULID at all. The monotonic factory increments the suffix instead, so
 * a bulk generate stays sorted.
 */
const ulid = monotonicFactory();

export type IdKind = 'uuidv4' | 'uuidv7' | 'ulid' | 'nanoid';

export const KINDS: readonly IdKind[] = ['uuidv4', 'uuidv7', 'ulid', 'nanoid'] as const;

export const KIND_NAMES: Record<IdKind, string> = {
  uuidv4: 'UUID v4',
  uuidv7: 'UUID v7',
  ulid: 'ULID',
  nanoid: 'NanoID',
};

export const KIND_NOTES: Record<IdKind, string> = {
  uuidv4: 'Random. 122 bits of entropy. No ordering — rows insert all over a B-tree index.',
  uuidv7: 'Timestamp-prefixed, so IDs sort by creation time and index locality is much better.',
  ulid: 'Timestamp-prefixed and Crockford base32. Sortable, case-insensitive, 26 chars.',
  nanoid: 'Compact URL-safe random string. 21 chars by default.',
};

const GENERATORS: Record<IdKind, () => string> = {
  uuidv4: () => uuidv4(),
  uuidv7: () => uuidv7(),
  ulid: () => ulid(),
  nanoid: () => nanoid(),
};

export interface Options {
  uppercase?: boolean;
  hyphens?: boolean;
}

export function generate(kind: IdKind, count: number, options: Options = {}): string[] {
  const { uppercase = false, hyphens = true } = options;
  const safeCount = Math.max(1, Math.min(1000, Math.floor(count) || 1));

  const out: string[] = [];
  for (let i = 0; i < safeCount; i++) {
    let id = GENERATORS[kind]();
    // Hyphens only exist in UUIDs; stripping them elsewhere would corrupt the value.
    if (!hyphens && (kind === 'uuidv4' || kind === 'uuidv7')) id = id.replace(/-/g, '');
    if (uppercase) id = id.toUpperCase();
    out.push(id);
  }
  return out;
}

/** Extracts the embedded timestamp from the time-ordered kinds. */
export function timestampOf(kind: IdKind, id: string): Date | null {
  try {
    if (kind === 'uuidv7') {
      const hex = id.replace(/-/g, '').slice(0, 12);
      if (hex.length !== 12) return null;
      return new Date(Number.parseInt(hex, 16));
    }
    if (kind === 'ulid') {
      // First 10 Crockford base32 chars are milliseconds since epoch.
      const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      const time = id.toUpperCase().slice(0, 10);
      let ms = 0;
      for (const ch of time) {
        const v = ALPHABET.indexOf(ch);
        if (v === -1) return null;
        ms = ms * 32 + v;
      }
      return new Date(ms);
    }
  } catch {
    return null;
  }
  return null;
}
