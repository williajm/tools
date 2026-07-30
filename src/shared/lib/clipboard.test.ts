/**
 * @vitest-environment node
 *
 * jsdom's Blob is a stub with neither `text()` nor `arrayBuffer()`, so the bytes
 * could not be inspected there — and inspecting the bytes is the point of these
 * tests. Node's Blob is the real thing. Nothing here needs a DOM: the clipboard
 * itself is stubbed either way, and the browser-only half is covered end to end.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { canCopyImages, copyImage, dataUriToBlob } from './clipboard.ts';

/** 1×1 transparent PNG. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dataUriToBlob', () => {
  it('decodes a base64 data URL to bytes of the declared type', async () => {
    const blob = dataUriToBlob(PNG);
    expect(blob.type).toBe('image/png');

    // Decoded, not re-encoded: the first bytes must be the PNG magic number.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBe(atob(PNG.split(',')[1]!).length);
  });

  it('handles a percent-encoded payload, which inline SVG uses', () => {
    const blob = dataUriToBlob('data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E');
    expect(blob.type).toBe('image/svg+xml');
    return expect(blob.text()).resolves.toBe('<svg></svg>');
  });

  it('keeps a payload containing newlines intact', async () => {
    // The regex needs the `s` flag for this; base64 from some encoders wraps.
    const uri = `data:text/plain;base64,${btoa('line one\nline two')}`;
    await expect(dataUriToBlob(uri).text()).resolves.toBe('line one\nline two');
  });

  it('rejects anything that is not a data URL', () => {
    for (const bad of ['', 'https://example.com/x.png', 'data:', 'notadatauri']) {
      expect(() => dataUriToBlob(bad), bad).toThrow(/Not a data URL/);
    }
  });
});

describe('copyImage', () => {
  it('writes a ClipboardItem of the image type, not text', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', class {
      items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    });
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });

    await copyImage(PNG);

    expect(writeText).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledOnce();
    const [items] = write.mock.calls[0] as [Array<{ items: Record<string, Blob> }>];
    expect(Object.keys(items[0]!.items)).toEqual(['image/png']);
  });

  /**
   * ClipboardItem is the piece browsers were slowest to ship. Failing loudly lets
   * CopyButton show "Copy failed" rather than appearing to succeed.
   */
  it('reports a browser that cannot copy images', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    await expect(copyImage(PNG)).rejects.toThrow(/cannot put images on the clipboard/);
  });

  it('rejects a malformed data URL before touching the clipboard', async () => {
    const write = vi.fn();
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', { clipboard: { write } });

    await expect(copyImage('https://example.com/x.png')).rejects.toThrow(/Not a data URL/);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('canCopyImages', () => {
  it('is false without ClipboardItem', () => {
    vi.stubGlobal('ClipboardItem', undefined);
    expect(canCopyImages()).toBe(false);
  });

  it('is false without clipboard.write', () => {
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', { clipboard: {} });
    expect(canCopyImages()).toBe(false);
  });

  it('is true when both are present', () => {
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', { clipboard: { write: () => Promise.resolve() } });
    expect(canCopyImages()).toBe(true);
  });
});
