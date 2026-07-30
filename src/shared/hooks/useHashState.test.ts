import { describe, it, expect } from 'vitest';
import { reconcile } from './useHashState.ts';

/**
 * A fragment is untrusted input: it survives truncation, hand-editing, and links
 * shared from an older version of a tool. It used to be cast straight to the
 * state type, so a valid-but-empty fragment left required fields undefined and
 * ten of the thirteen tools rendered a blank page on the first `.trim()`.
 */
describe('reconcile', () => {
  const initial = { text: '', count: 5, on: false, mode: 'a' };

  it('fills every missing key from the defaults', () => {
    expect(reconcile({}, initial)).toEqual(initial);
  });

  it('keeps values that are present and of the right type', () => {
    expect(reconcile({ text: 'hi', count: 9, on: true, mode: 'b' }, initial)).toEqual({
      text: 'hi',
      count: 9,
      on: true,
      mode: 'b',
    });
  });

  it('takes the good keys and defaults the rest', () => {
    expect(reconcile({ text: 'hi' }, initial)).toEqual({ ...initial, text: 'hi' });
  });

  it('rejects a value of the wrong type rather than passing it through', () => {
    expect(reconcile({ text: 42 }, initial).text).toBe('');
    expect(reconcile({ count: 'nine' }, initial).count).toBe(5);
    expect(reconcile({ on: 'yes' }, initial).on).toBe(false);
  });

  it('rejects null, which typeof would otherwise call an object', () => {
    expect(reconcile({ text: null }, initial).text).toBe('');
    expect(reconcile({ mode: null }, initial).mode).toBe('a');
  });

  it('drops keys the tool does not declare', () => {
    expect(reconcile({ text: 'hi', removedLastVersion: 1 }, initial)).toEqual({
      ...initial,
      text: 'hi',
    });
  });

  it('falls back entirely for a non-object fragment', () => {
    for (const junk of [null, 42, 'string', [1, 2, 3], true]) {
      expect(reconcile(junk, initial)).toEqual(initial);
    }
  });

  it('reconciles nested objects rather than taking them whole', () => {
    const nested = { opts: { a: 1, b: 'x' }, top: '' };
    expect(reconcile({ opts: { a: 7 } }, nested)).toEqual({ opts: { a: 7, b: 'x' }, top: '' });
    expect(reconcile({ opts: 'not an object' }, nested)).toEqual(nested);
  });

  it('accepts arrays wholesale but not in place of an array default', () => {
    const withList = { items: ['a'], name: '' };
    expect(reconcile({ items: ['x', 'y'] }, withList).items).toEqual(['x', 'y']);
    expect(reconcile({ items: 'nope' }, withList).items).toEqual(['a']);
    expect(reconcile({ items: [] }, withList).items).toEqual([]);
  });

  it('never returns undefined for a declared key', () => {
    for (const junk of [{}, { text: undefined }, { count: null }, [], 'x', null]) {
      const result = reconcile(junk, initial) as Record<string, unknown>;
      for (const key of Object.keys(initial)) {
        expect(result[key], `${key} for ${JSON.stringify(junk)}`).toBeDefined();
      }
    }
  });
});
