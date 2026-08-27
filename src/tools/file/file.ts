import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Files of an exact size, for testing what happens at a limit.
 *
 * "Reject anything over 10 MB" needs a 10,485,760-byte file and a
 * 10,485,761-byte one; chunked uploads need something that spans chunks;
 * progress bars and timeouts need something big. Nobody has those lying
 * around, and `dd if=/dev/urandom` is not available to everyone.
 */

export type Fill = 'random' | 'zeros';

export const FILLS: readonly Fill[] = ['random', 'zeros'];

export const FILL_NAMES: Record<Fill, string> = {
  random: 'Random bytes',
  zeros: 'Zero bytes',
};

export const FILL_NOTES: Record<Fill, string> = {
  random:
    'Incompressible, like a real photo or archive. Use this to measure upload speed or to exercise a size limit honestly — compression in the path cannot shrink it.',
  zeros:
    'Compresses to almost nothing, so anything with compression in the path moves it in an instant. Fine for tripping a size check; useless for measuring throughput.',
};

export type SizeUnit = 'B' | 'KB' | 'MB' | 'GB' | 'KiB' | 'MiB' | 'GiB';

export const SIZE_UNITS: readonly SizeUnit[] = ['B', 'KB', 'MB', 'GB', 'KiB', 'MiB', 'GiB'];

/**
 * Decimal and binary units are both offered because limits are quoted in both,
 * and "10 MB" versus "10 MiB" is a 4.9% gap — exactly the kind of margin a
 * boundary test is meant to find.
 */
export const UNIT_BYTES: Record<SizeUnit, number> = {
  B: 1,
  KB: 1000,
  MB: 1_000_000,
  GB: 1_000_000_000,
  KiB: 1024,
  MiB: 1024 * 1024,
  GiB: 1024 * 1024 * 1024,
};

/**
 * The file is built in browser memory and stays there until it is saved, so
 * this is a memory budget rather than a technical limit. 1 GiB covers every
 * upload limit worth testing and takes a few seconds to build.
 */
export const MAX_BYTES = 1024 * 1024 * 1024;

export function toBytes(size: number, unit: SizeUnit): number {
  return Math.round(size * UNIT_BYTES[unit]);
}

/**
 * Largest value the size field accepts in `unit` without exceeding MAX_BYTES.
 * Not floored: the field takes decimals, and 1073.5 MB is under the limit.
 */
export function maxFor(unit: SizeUnit): number {
  return MAX_BYTES / UNIT_BYTES[unit];
}

export interface Request {
  size: number;
  unit: SizeUnit;
  fill: Fill;
}

export const DEFAULT_REQUEST: Request = { size: 10, unit: 'MiB', fill: 'random' };

/**
 * Reconciles state from the URL fragment, which only guarantees the field
 * types. An unknown unit would make every limit NaN and disable the page; an
 * unknown fill would select nothing yet still generate. Each bad field falls
 * back to its default independently and the size is kept inside the ceiling.
 */
export function normalise(request: Request): Request {
  const unit = SIZE_UNITS.includes(request.unit) ? request.unit : DEFAULT_REQUEST.unit;
  const fill = FILLS.includes(request.fill) ? request.fill : DEFAULT_REQUEST.fill;
  const size =
    Number.isFinite(request.size) && request.size > 0
      ? Math.min(request.size, maxFor(unit))
      : DEFAULT_REQUEST.size;
  return { size, unit, fill };
}

export function suggestedFilename(size: number, unit: SizeUnit, fill: Fill): string {
  return `${fill}-${size}${unit}.bin`;
}

export interface Generated {
  blob: Blob;
  bytes: number;
  /** Hex digest of the whole file, for checking what a server stored. */
  sha256: string;
}

const CHUNK = 1024 * 1024;

/** `crypto.getRandomValues` refuses to fill more than this in one call. */
const RANDOM_CALL_MAX = 65536;

/**
 * Builds the file one chunk at a time, hashing as it goes. WebCrypto cannot
 * hash incrementally, so this uses a streaming SHA-256 rather than holding a
 * second copy of the file for `crypto.subtle.digest`.
 *
 * Each chunk becomes its own Blob and the file is a Blob of those: the browser
 * can spill blobs to disk, whereas one 1 GiB Uint8Array has to fit in memory.
 */
export async function generateFile(
  bytes: number,
  fill: Fill,
  onProgress?: (doneBytes: number) => void,
): Promise<Generated> {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) {
    throw new RangeError(`Size must be a whole number of bytes from 1 to ${MAX_BYTES.toLocaleString()}.`);
  }

  const hash = sha256.create();
  const parts: Blob[] = [];
  // Zero chunks are identical, so one Blob serves every full chunk.
  const zeros = new Uint8Array(CHUNK);
  const zeroBlob = new Blob([zeros]);

  let done = 0;
  while (done < bytes) {
    const size = Math.min(CHUNK, bytes - done);
    if (fill === 'zeros') {
      hash.update(zeros.subarray(0, size));
      parts.push(size === CHUNK ? zeroBlob : zeroBlob.slice(0, size));
    } else {
      const chunk = new Uint8Array(size);
      for (let at = 0; at < size; at += RANDOM_CALL_MAX) {
        crypto.getRandomValues(chunk.subarray(at, Math.min(at + RANDOM_CALL_MAX, size)));
      }
      hash.update(chunk);
      parts.push(new Blob([chunk]));
    }
    done += size;
    onProgress?.(done);
    // Yield every 8 MiB so progress paints and the page keeps responding.
    if (done % (8 * CHUNK) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    blob: new Blob(parts, { type: 'application/octet-stream' }),
    bytes,
    sha256: bytesToHex(hash.digest()),
  };
}
