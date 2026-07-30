import { containsCidr, excludeCidr, mergeCidr, overlapCidr, parseCidr } from 'cidr-tools';
import { parseIp, stringifyIp } from 'ip-bigint';
import ipRegex from 'ip-regex';

/**
 * Subnet maths for IPv4 and IPv6.
 *
 * `cidr-tools` parses and does the set algebra; `ip-bigint` converts between
 * BigInt and printable form. Everything here is derivation on top of those:
 * masks, counts, usable ranges, reverse-DNS names and classification.
 *
 * Input is validated with `ip-regex` before either library sees it. Neither
 * validates strictly: `parseCidr('300.1.1.1')` returns 44.1.1.1 and
 * `parseCidr('2001:db8:::1')` returns 2001:db8::1, both without complaint. A
 * subnet calculator that silently answers a question you did not ask is worse
 * than one that refuses, so a typo has to be a hard error here.
 */

const V4 = ipRegex.v4({ exact: true });
const V6 = ipRegex.v6({ exact: true });

export type Version = 4 | 6;

const BITS: Record<Version, number> = { 4: 32, 6: 128 };

export interface Info {
  /** Network address with prefix, normalised — the canonical form of the input. */
  cidr: string;
  version: Version;
  prefix: number;
  hostBits: number;
  /** True when the input carried no prefix, so it names a single address. */
  singleAddress: boolean;
  /** Set when the address typed was not the network address. */
  hostAddress?: string;
  network: string;
  /** Last address in the block. For IPv4 this is the broadcast address. */
  lastAddress: string;
  firstUsable: string;
  lastUsable: string;
  /** IPv4 only — IPv6 has no netmask notation in practice. */
  netmask?: string;
  wildcard?: string;
  totalAddresses: bigint;
  usableAddresses: bigint;
  /** Reverse-DNS name of the network address. */
  reverse: string;
  /** Reverse-DNS zone, only when the prefix lands on a delegation boundary. */
  reverseZone?: string;
  /** Special-purpose ranges that contain this block, if any. */
  classification: string[];
}

export type Result = { ok: true; info: Info } | { ok: false; error: string };

/**
 * Special-purpose address registries, as the parts of them a reader cares about.
 * Ordered widest-first so the labels read outermost to innermost.
 */
const SPECIAL: Record<Version, ReadonlyArray<readonly [string, string]>> = {
  4: [
    ['0.0.0.0/8', 'This network (RFC 1122)'],
    ['10.0.0.0/8', 'Private (RFC 1918)'],
    ['100.64.0.0/10', 'Carrier-grade NAT (RFC 6598)'],
    ['127.0.0.0/8', 'Loopback'],
    ['169.254.0.0/16', 'Link-local (RFC 3927)'],
    ['172.16.0.0/12', 'Private (RFC 1918)'],
    ['192.0.0.0/24', 'IETF protocol assignments'],
    ['192.0.2.0/24', 'Documentation — TEST-NET-1'],
    ['192.88.99.0/24', '6to4 relay anycast (deprecated)'],
    ['192.168.0.0/16', 'Private (RFC 1918)'],
    ['198.18.0.0/15', 'Benchmarking (RFC 2544)'],
    ['198.51.100.0/24', 'Documentation — TEST-NET-2'],
    ['203.0.113.0/24', 'Documentation — TEST-NET-3'],
    ['224.0.0.0/4', 'Multicast'],
    ['240.0.0.0/4', 'Reserved'],
    ['255.255.255.255/32', 'Limited broadcast'],
  ],
  6: [
    ['::/128', 'Unspecified'],
    ['::1/128', 'Loopback'],
    ['::ffff:0:0/96', 'IPv4-mapped'],
    ['64:ff9b::/96', 'NAT64 (RFC 6052)'],
    ['100::/64', 'Discard-only'],
    ['2000::/3', 'Global unicast'],
    ['2001::/32', 'Teredo'],
    ['2001:db8::/32', 'Documentation'],
    ['2002::/16', '6to4'],
    ['fc00::/7', 'Unique local (RFC 4193)'],
    ['fe80::/10', 'Link-local'],
    ['ff00::/8', 'Multicast'],
  ],
};

/**
 * Labels the special-purpose ranges containing `cidr`.
 *
 * A block that only partly overlaps one is reported as mixed rather than
 * labelled, since neither "private" nor "public" would be true of all of it.
 */
export function classify(cidr: string, version: Version): string[] {
  const labels: string[] = [];
  let overlapping = false;

  for (const [range, label] of SPECIAL[version]) {
    if (containsCidr(range, cidr)) {
      if (!labels.includes(label)) labels.push(label);
    } else if (overlapCidr(range, cidr)) {
      overlapping = true;
    }
  }

  if (labels.length > 0) return labels;
  return [overlapping ? 'Mixed — spans special-purpose ranges' : 'Public — globally routable'];
}

/** Reverse-DNS name of a single address: `4.3.2.1.in-addr.arpa` style. */
function reverseName(number: bigint, version: Version): string {
  if (version === 4) {
    return `${stringifyIp({ number, version: 4 }).split('.').reverse().join('.')}.in-addr.arpa`;
  }
  const nibbles = number.toString(16).padStart(32, '0');
  return `${[...nibbles].reverse().join('.')}.ip6.arpa`;
}

/**
 * Reverse-DNS zone for the block, when the prefix falls on a delegation
 * boundary — every 8 bits for IPv4, every 4 for IPv6. Prefixes in between need
 * RFC 2317 classless delegation, which is not a single zone name.
 */
function reverseZone(number: bigint, version: Version, prefix: number): string | undefined {
  if (version === 4) {
    if (prefix % 8 !== 0) return undefined;
    const octets = stringifyIp({ number, version: 4 }).split('.').slice(0, prefix / 8);
    return octets.length === 0 ? 'in-addr.arpa' : `${octets.reverse().join('.')}.in-addr.arpa`;
  }
  if (prefix % 4 !== 0) return undefined;
  const nibbles = [...number.toString(16).padStart(32, '0')].slice(0, prefix / 4);
  return nibbles.length === 0 ? 'ip6.arpa' : `${nibbles.reverse().join('.')}.ip6.arpa`;
}

export function describe(raw: string): Result {
  const input = raw.trim();
  if (!input) return { ok: false, error: 'Enter an IP address or CIDR block.' };

  const slash = input.lastIndexOf('/');
  const literal = slash === -1 ? input : input.slice(0, slash);
  const prefixText = slash === -1 ? undefined : input.slice(slash + 1);

  const version: Version | undefined = V4.test(literal) ? 4 : V6.test(literal) ? 6 : undefined;
  if (!version) {
    return { ok: false, error: `${literal || input} is not a valid IPv4 or IPv6 address.` };
  }

  const bits = BITS[version];
  if (prefixText !== undefined && !/^\d+$/.test(prefixText)) {
    // Reached while someone is still typing "10.0.0.0/", so say what is missing
    // rather than quoting the empty string back at them.
    return {
      ok: false,
      error: prefixText === ''
        ? 'Add a prefix length after the “/”.'
        : `Prefix must be a whole number of bits, not “${prefixText}”.`,
    };
  }

  const prefix = prefixText === undefined ? bits : Number(prefixText);
  // cidr-tools accepts an out-of-range prefix and quietly returns a one-address
  // range for it, so /33 would otherwise look like a valid host route.
  if (prefix > bits) {
    return {
      ok: false,
      error: `Prefix /${prefixText} is out of range for IPv${version} — must be 0 to ${bits}.`,
    };
  }

  let parsed;
  try {
    parsed = parseCidr(input);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const network = stringifyIp({ number: parsed.start, version });
  const lastAddress = stringifyIp({ number: parsed.end, version });
  const cidr = `${network}/${prefix}`;
  const totalAddresses = parsed.end - parsed.start + 1n;

  // IPv4 reserves the network and broadcast addresses, except on a /31 where
  // RFC 3021 puts both ends to work, and a /32 which is a single host route.
  // IPv6 reserves neither.
  let firstUsable = network;
  let lastUsable = lastAddress;
  let usableAddresses = totalAddresses;
  if (version === 4 && prefix <= 30) {
    firstUsable = stringifyIp({ number: parsed.start + 1n, version });
    lastUsable = stringifyIp({ number: parsed.end - 1n, version });
    usableAddresses = totalAddresses - 2n;
  }

  const info: Info = {
    cidr,
    version,
    prefix,
    hostBits: bits - prefix,
    singleAddress: !parsed.prefixPresent,
    network,
    lastAddress,
    firstUsable,
    lastUsable,
    totalAddresses,
    usableAddresses,
    reverse: reverseName(parsed.start, version),
    reverseZone: reverseZone(parsed.start, version, prefix),
    classification: classify(cidr, version),
  };

  if (version === 4) {
    const wildcard = 2n ** BigInt(bits - prefix) - 1n;
    info.netmask = stringifyIp({ number: 2n ** BigInt(bits) - 1n - wildcard, version });
    info.wildcard = stringifyIp({ number: wildcard, version });
  }

  // Someone pasting 10.0.0.5/24 usually wants to know about the /24 but should
  // still see the host they typed, which the normalised CIDR discards.
  const typed = parseIp(parsed.ip).number;
  if (parsed.prefixPresent && typed !== parsed.start) {
    info.hostAddress = stringifyIp({ number: typed, version });
  }

  return { ok: true, info };
}

export interface Subnet {
  cidr: string;
  network: string;
  lastAddress: string;
}

export interface SplitResult {
  subnets: Subnet[];
  /** How many subnets the split produces in total, which may exceed `limit`. */
  total: bigint;
  truncated: boolean;
  error?: string;
}

/**
 * Divides a block into equal subnets of `newPrefix`.
 *
 * A /8 split into /32s is 16 million rows, so only the first `limit` are
 * materialised and the caller is told the real total.
 */
export function splitSubnets(info: Info, newPrefix: number, limit = 256): SplitResult {
  const bits = BITS[info.version];
  const empty = { subnets: [], total: 0n, truncated: false };

  if (!Number.isInteger(newPrefix) || newPrefix < 0 || newPrefix > bits) {
    return { ...empty, error: `Prefix must be 0 to ${bits} for IPv${info.version}.` };
  }
  if (newPrefix < info.prefix) {
    return { ...empty, error: `/${newPrefix} is larger than /${info.prefix} — it cannot subdivide it.` };
  }

  const total = 2n ** BigInt(newPrefix - info.prefix);
  const size = 2n ** BigInt(bits - newPrefix);
  const start = parseCidr(info.cidr).start;
  const shown = total < BigInt(limit) ? total : BigInt(limit);

  const subnets: Subnet[] = [];
  for (let i = 0n; i < shown; i++) {
    const from = start + i * size;
    subnets.push({
      cidr: `${stringifyIp({ number: from, version: info.version })}/${newPrefix}`,
      network: stringifyIp({ number: from, version: info.version }),
      lastAddress: stringifyIp({ number: from + size - 1n, version: info.version }),
    });
  }

  return { subnets, total, truncated: total > shown };
}

/** Splits a textarea of networks on newlines, commas or spaces. */
export function parseList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SetResult {
  mergedA: string[];
  mergedB: string[];
  aMinusB: string[];
  bMinusA: string[];
  aContainsB: boolean;
  bContainsA: boolean;
  overlaps: boolean;
  error?: string;
}

const EMPTY_SET: SetResult = {
  mergedA: [],
  mergedB: [],
  aMinusB: [],
  bMinusA: [],
  aContainsB: false,
  bContainsA: false,
  overlaps: false,
};

/**
 * Set algebra over two lists of networks: merge each, subtract each from the
 * other, and answer containment and overlap.
 *
 * Mixed IPv4 and IPv6 lists are fine — the operations treat the two families as
 * disjoint, which is what `containsCidr` and `overlapCidr` already do.
 */
export function compareSets(aText: string, bText: string): SetResult {
  const a = parseList(aText);
  const b = parseList(bText);
  if (a.length === 0 && b.length === 0) return EMPTY_SET;

  try {
    return {
      mergedA: a.length ? mergeCidr(a) : [],
      mergedB: b.length ? mergeCidr(b) : [],
      aMinusB: a.length ? (b.length ? excludeCidr(a, b) : mergeCidr(a)) : [],
      bMinusA: b.length ? (a.length ? excludeCidr(b, a) : mergeCidr(b)) : [],
      aContainsB: a.length > 0 && b.length > 0 && containsCidr(a, b),
      bContainsA: a.length > 0 && b.length > 0 && containsCidr(b, a),
      overlaps: a.length > 0 && b.length > 0 && overlapCidr(a, b),
    };
  } catch (err) {
    return { ...EMPTY_SET, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Groups a count into digits a human can read: 4 294 967 296. */
export function formatCount(n: bigint): string {
  return n.toLocaleString('en-GB').replace(/,/g, ' ');
}
