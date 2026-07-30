import { describe as suite, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  classify,
  compareSets,
  describe,
  formatCount,
  parseList,
  ruler,
  splitSubnets,
  type Info,
} from './cidr.ts';

const info = (input: string): Info => {
  const result = describe(input);
  if (!result.ok) throw new Error(`expected ${input} to parse: ${result.error}`);
  return result.info;
};

suite('describe — IPv4', () => {
  it('derives the standard fields of a /24', () => {
    const i = info('192.168.1.0/24');
    expect(i).toMatchObject({
      cidr: '192.168.1.0/24',
      version: 4,
      prefix: 24,
      hostBits: 8,
      network: '192.168.1.0',
      lastAddress: '192.168.1.255',
      firstUsable: '192.168.1.1',
      lastUsable: '192.168.1.254',
      netmask: '255.255.255.0',
      wildcard: '0.0.0.255',
      totalAddresses: 256n,
      usableAddresses: 254n,
    });
  });

  it('rounds a host address down to its network and reports the host', () => {
    const i = info('10.0.0.5/24');
    expect(i.cidr).toBe('10.0.0.0/24');
    expect(i.hostAddress).toBe('10.0.0.5');
  });

  it('does not report a host address when the input is the network address', () => {
    expect(info('10.0.0.0/24').hostAddress).toBeUndefined();
  });

  it('treats a bare address as a single address', () => {
    const i = info('8.8.8.8');
    expect(i.singleAddress).toBe(true);
    expect(i.prefix).toBe(32);
    expect(i.totalAddresses).toBe(1n);
    expect(i.usableAddresses).toBe(1n);
  });

  it('gives both addresses of a /31 to hosts, per RFC 3021', () => {
    const i = info('10.0.0.0/31');
    expect(i.totalAddresses).toBe(2n);
    expect(i.usableAddresses).toBe(2n);
    expect(i.firstUsable).toBe('10.0.0.0');
    expect(i.lastUsable).toBe('10.0.0.1');
  });

  it('handles the whole address space', () => {
    const i = info('0.0.0.0/0');
    expect(i.totalAddresses).toBe(4294967296n);
    expect(i.usableAddresses).toBe(4294967294n);
    expect(i.netmask).toBe('0.0.0.0');
    expect(i.wildcard).toBe('255.255.255.255');
  });

  it('computes netmasks across every prefix length', () => {
    expect(info('10.0.0.0/1').netmask).toBe('128.0.0.0');
    expect(info('10.0.0.0/12').netmask).toBe('255.240.0.0');
    expect(info('10.0.0.0/30').netmask).toBe('255.255.255.252');
    expect(info('10.0.0.0/32').netmask).toBe('255.255.255.255');
  });
});

suite('describe — IPv6', () => {
  it('derives the standard fields of a /64', () => {
    const i = info('2001:db8:1:2::/64');
    expect(i).toMatchObject({
      cidr: '2001:db8:1:2::/64',
      version: 6,
      prefix: 64,
      hostBits: 64,
      network: '2001:db8:1:2::',
      lastAddress: '2001:db8:1:2:ffff:ffff:ffff:ffff',
    });
    expect(i.totalAddresses).toBe(2n ** 64n);
    // IPv6 reserves neither end of the block.
    expect(i.usableAddresses).toBe(2n ** 64n);
    expect(i.firstUsable).toBe('2001:db8:1:2::');
  });

  it('omits the netmask, which IPv6 does not use', () => {
    expect(info('2001:db8::/32').netmask).toBeUndefined();
    expect(info('2001:db8::/32').wildcard).toBeUndefined();
  });

  it('compresses the network address', () => {
    expect(info('2001:0db8:0000:0000:0000:0000:0000:0001').network).toBe('2001:db8::1');
  });
});

suite('describe — rejection', () => {
  it('rejects a prefix beyond the address size', () => {
    // Regression: cidr-tools accepts /33 and silently returns a one-address
    // range, so an out-of-range prefix has to be caught here.
    expect(describe('10.0.0.0/33')).toEqual({
      ok: false,
      error: 'Prefix /33 is out of range for IPv4 — must be 0 to 32.',
    });
    expect(describe('2001:db8::/129').ok).toBe(false);
    expect(describe('10.0.0.0/-1').ok).toBe(false);
    expect(describe('10.0.0.0/x').ok).toBe(false);
  });

  it('asks for the missing prefix rather than quoting an empty one', () => {
    expect(describe('10.0.0.0/')).toEqual({ ok: false, error: 'Add a prefix length after the “/”.' });
  });

  it('accepts the boundary prefixes', () => {
    expect(describe('10.0.0.0/32').ok).toBe(true);
    expect(describe('2001:db8::/128').ok).toBe(true);
  });

  it('rejects nonsense and empty input', () => {
    expect(describe('').ok).toBe(false);
    expect(describe('   ').ok).toBe(false);
    expect(describe('not an ip').ok).toBe(false);
    expect(describe('10.0.0.0/8/8').ok).toBe(false);
  });

  it('rejects malformed addresses the parser would silently rewrite', () => {
    // Regression: cidr-tools quietly reinterprets each of these rather than
    // failing, so 300.1.1.1 came back as 44.1.1.1 and 2001:db8:::1 as
    // 2001:db8::1 — confidently wrong answers to a question nobody asked.
    for (const bad of [
      '300.1.1.1',
      '256.0.0.1',
      '1.2.3',
      '1.2.3.4.5',
      '0x0a.1.1.1',
      '10.0.0.01',
      '2001:db8:::1',
      '1:2:3:4:5:6:7:8:9',
      '2001:db8::g',
    ]) {
      expect(describe(bad), bad).toMatchObject({ ok: false });
    }
  });

  it('accepts the forms that are genuinely valid', () => {
    for (const good of [
      '0.0.0.0/0',
      '255.255.255.255',
      '2001:DB8::1',
      '2001:0db8:0000:0000:0000:0000:0000:0001',
      '::ffff:1.2.3.4',
      '::',
    ]) {
      expect(describe(good), good).toMatchObject({ ok: true });
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(info('  10.0.0.0/8  ').cidr).toBe('10.0.0.0/8');
  });
});

suite('reverse DNS', () => {
  it('names the network address', () => {
    expect(info('10.1.2.3').reverse).toBe('3.2.1.10.in-addr.arpa');
    expect(info('2001:db8::1').reverse).toBe(
      '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa',
    );
  });

  it('gives a zone only on a delegation boundary', () => {
    expect(info('10.0.0.0/8').reverseZone).toBe('10.in-addr.arpa');
    expect(info('192.168.1.0/24').reverseZone).toBe('1.168.192.in-addr.arpa');
    expect(info('0.0.0.0/0').reverseZone).toBe('in-addr.arpa');
    // /25 needs RFC 2317 classless delegation, which is not a single zone.
    expect(info('192.168.1.0/25').reverseZone).toBeUndefined();
    expect(info('2001:db8::/32').reverseZone).toBe('8.b.d.0.1.0.0.2.ip6.arpa');
    expect(info('2001:db8::/33').reverseZone).toBeUndefined();
  });
});

suite('classify', () => {
  it('labels the private ranges', () => {
    expect(classify('10.0.0.0/8', 4)).toContain('Private (RFC 1918)');
    expect(classify('192.168.1.0/24', 4)).toContain('Private (RFC 1918)');
    expect(classify('172.16.5.0/24', 4)).toContain('Private (RFC 1918)');
    expect(classify('fd00::/8', 6)).toContain('Unique local (RFC 4193)');
  });

  it('labels documentation and loopback ranges', () => {
    expect(classify('192.0.2.10/32', 4)).toContain('Documentation — TEST-NET-1');
    expect(classify('127.0.0.1/32', 4)).toContain('Loopback');
    expect(classify('2001:db8::/48', 6)).toContain('Documentation');
    expect(classify('::1/128', 6)).toContain('Loopback');
  });

  it('calls a public address public', () => {
    expect(classify('8.8.8.8/32', 4)).toEqual(['Public — globally routable']);
  });

  it('will not label a block that only partly overlaps a special range', () => {
    expect(classify('0.0.0.0/0', 4)).toEqual(['Mixed — spans special-purpose ranges']);
    expect(classify('172.0.0.0/8', 4)).toEqual(['Mixed — spans special-purpose ranges']);
  });

  it('nests labels outermost first', () => {
    // 2001:db8::/32 sits inside 2000::/3.
    expect(classify('2001:db8::/32', 6)).toEqual(['Global unicast', 'Documentation']);
  });
});

suite('splitSubnets', () => {
  it('divides a /24 into four /26s', () => {
    const result = splitSubnets(info('192.168.1.0/24'), 26);
    expect(result.error).toBeUndefined();
    expect(result.total).toBe(4n);
    expect(result.truncated).toBe(false);
    expect(result.subnets.map((s) => s.cidr)).toEqual([
      '192.168.1.0/26',
      '192.168.1.64/26',
      '192.168.1.128/26',
      '192.168.1.192/26',
    ]);
    expect(result.subnets[3].lastAddress).toBe('192.168.1.255');
  });

  it('returns the block itself when the prefix is unchanged', () => {
    const result = splitSubnets(info('10.0.0.0/8'), 8);
    expect(result.total).toBe(1n);
    expect(result.subnets.map((s) => s.cidr)).toEqual(['10.0.0.0/8']);
  });

  it('refuses a prefix shorter than the block', () => {
    expect(splitSubnets(info('10.0.0.0/24'), 16).error).toMatch(/cannot subdivide/);
  });

  it('refuses a prefix outside the address size', () => {
    expect(splitSubnets(info('10.0.0.0/24'), 33).error).toMatch(/0 to 32/);
    expect(splitSubnets(info('2001:db8::/32'), 129).error).toMatch(/0 to 128/);
  });

  it('caps a split that would produce millions of rows', () => {
    const result = splitSubnets(info('10.0.0.0/8'), 32, 10);
    expect(result.total).toBe(2n ** 24n);
    expect(result.truncated).toBe(true);
    expect(result.subnets).toHaveLength(10);
    expect(result.subnets[9].cidr).toBe('10.0.0.9/32');
  });

  it('splits IPv6 without losing precision', () => {
    const result = splitSubnets(info('2001:db8::/32'), 34);
    expect(result.subnets.map((s) => s.cidr)).toEqual([
      '2001:db8::/34',
      '2001:db8:4000::/34',
      '2001:db8:8000::/34',
      '2001:db8:c000::/34',
    ]);
  });

  it('covers the parent block exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 16, max: 24 }), fc.integer({ min: 0, max: 6 }), (base, extra) => {
        const parent = info(`10.0.0.0/${base}`);
        const result = splitSubnets(parent, base + extra, 1024);
        expect(result.truncated).toBe(false);
        const covered = result.subnets.reduce(
          (sum) => sum + 2n ** BigInt(32 - (base + extra)),
          0n,
        );
        expect(covered).toBe(parent.totalAddresses);
      }),
      { numRuns: 60 },
    );
  });
});

suite('parseList', () => {
  it('splits on newlines, commas and spaces', () => {
    expect(parseList('10.0.0.0/8\n192.168.0.0/16, 172.16.0.0/12 8.8.8.8')).toEqual([
      '10.0.0.0/8',
      '192.168.0.0/16',
      '172.16.0.0/12',
      '8.8.8.8',
    ]);
  });

  it('ignores blank input', () => {
    expect(parseList('  \n\n , ')).toEqual([]);
  });
});

suite('compareSets', () => {
  it('merges adjacent networks', () => {
    expect(compareSets('10.0.0.0/24\n10.0.1.0/24', '').mergedA).toEqual(['10.0.0.0/23']);
  });

  it('subtracts one set from the other', () => {
    const result = compareSets('10.0.0.0/24', '10.0.0.128/25');
    expect(result.aMinusB).toEqual(['10.0.0.0/25']);
    expect(result.bMinusA).toEqual([]);
    expect(result.aContainsB).toBe(true);
    expect(result.bContainsA).toBe(false);
    expect(result.overlaps).toBe(true);
  });

  it('reports disjoint sets as not overlapping', () => {
    const result = compareSets('10.0.0.0/24', '192.168.0.0/24');
    expect(result.overlaps).toBe(false);
    expect(result.aMinusB).toEqual(['10.0.0.0/24']);
  });

  it('treats the two address families as disjoint', () => {
    const result = compareSets('10.0.0.0/8', '2001:db8::/32');
    expect(result.overlaps).toBe(false);
    expect(result.aMinusB).toEqual(['10.0.0.0/8']);
  });

  it('passes a set through when the other side is empty', () => {
    const result = compareSets('10.0.0.0/24\n10.0.1.0/24', '');
    expect(result.aMinusB).toEqual(['10.0.0.0/23']);
    expect(result.aContainsB).toBe(false);
    expect(result.overlaps).toBe(false);
  });

  it('reports a parse failure instead of throwing', () => {
    const result = compareSets('not-a-network', '10.0.0.0/8');
    expect(result.error).toBeTruthy();
    expect(result.mergedA).toEqual([]);
  });

  it('does nothing when both sides are empty', () => {
    const result = compareSets('', '');
    expect(result.error).toBeUndefined();
    expect(result.mergedA).toEqual([]);
    expect(result.mergedB).toEqual([]);
  });
});

suite('ruler', () => {
  it('marks the network bits of an IPv4 block', () => {
    const r = ruler(info('192.168.1.0/24'));
    expect(r.cells).toHaveLength(32);
    expect(r.bitsPerCell).toBe(1);
    expect(r.cells.filter((c) => c.part === 'network')).toHaveLength(24);
    expect(r.cells.filter((c) => c.part === 'host')).toHaveLength(8);
    // 192 = 11000000, and the boundary never splits a bit.
    expect(r.cells.slice(0, 8).map((c) => c.label).join('')).toBe('11000000');
    expect(r.cells.some((c) => c.part === 'split')).toBe(false);
  });

  it('handles the extremes of the IPv4 space', () => {
    expect(ruler(info('0.0.0.0/0')).cells.every((c) => c.part === 'host')).toBe(true);
    expect(ruler(info('10.0.0.1/32')).cells.every((c) => c.part === 'network')).toBe(true);
  });

  it('shows IPv6 as nibbles, since 128 bits cannot be read', () => {
    const r = ruler(info('2001:db8::/32'));
    expect(r.cells).toHaveLength(32);
    expect(r.bitsPerCell).toBe(4);
    expect(r.cells.slice(0, 8).map((c) => c.label).join('')).toBe('20010db8');
    expect(r.cells.filter((c) => c.part === 'network')).toHaveLength(8);
  });

  it('reports where the boundary falls between cells', () => {
    expect(ruler(info('192.168.1.0/24')).boundary).toBe(24);
    expect(ruler(info('10.0.0.0/0')).boundary).toBe(0);
    expect(ruler(info('10.0.0.1/32')).boundary).toBe(32);
    // Eight whole nibbles of network.
    expect(ruler(info('2001:db8::/32')).boundary).toBe(8);
    // Mid-nibble: there is no line to draw between two cells.
    expect(ruler(info('2001:db8::/34')).boundary).toBeNull();
  });

  it('marks a nibble the prefix cuts through as split', () => {
    const r = ruler(info('2001:db8::/34'));
    // 34 bits is eight whole nibbles plus half of the ninth.
    expect(r.cells.filter((c) => c.part === 'network')).toHaveLength(8);
    expect(r.cells[8].part).toBe('split');
    expect(r.cells.filter((c) => c.part === 'split')).toHaveLength(1);
  });

  it('never loses a cell, whatever the prefix', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 32 }), (prefix) => {
        const r = ruler(info(`10.20.30.40/${prefix}`));
        expect(r.cells).toHaveLength(32);
        expect(r.cells.filter((c) => c.part === 'network')).toHaveLength(prefix);
      }),
      { numRuns: 33 },
    );
  });
});

suite('formatCount', () => {
  it('groups large counts with spaces', () => {
    expect(formatCount(4294967296n)).toBe('4 294 967 296');
    expect(formatCount(254n)).toBe('254');
  });
});
