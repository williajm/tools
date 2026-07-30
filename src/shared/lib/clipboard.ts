/**
 * Putting an image on the clipboard.
 *
 * `navigator.clipboard.writeText` only ever produces text, so an image needs
 * `clipboard.write` with a real `Blob`. Getting that Blob is the awkward part
 * here: the usual trick is `fetch(dataUri).then(r => r.blob())`, and `fetch` is
 * governed by `connect-src`, which this site sets to `'none'`. So the data URL is
 * decoded by hand instead — no request, nothing for the CSP to refuse.
 */

/** Splits `data:<mime>[;base64],<payload>`. The `s` flag matters: payloads contain newlines. */
const DATA_URI = /^data:([^;,]+)(;base64)?,(.*)$/s;

export function dataUriToBlob(uri: string): Blob {
  const match = DATA_URI.exec(uri);
  if (!match) throw new Error('Not a data URL.');

  const [, mime, base64, payload] = match as unknown as [string, string, string | undefined, string];

  if (!base64) {
    // Percent-encoded rather than base64 — legal, and what an inline SVG uses.
    return new Blob([decodeURIComponent(payload)], { type: mime });
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Whether this browser can put anything but text on the clipboard. */
export function canCopyImages(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  );
}

/**
 * Copies a data-URL image to the clipboard as an image, not as its source text.
 *
 * Must be called from a user gesture in a secure context; both are true of a
 * button click on the deployed site.
 */
export async function copyImage(dataUri: string): Promise<void> {
  if (!canCopyImages()) {
    throw new Error('This browser cannot put images on the clipboard.');
  }
  const blob = dataUriToBlob(dataUri);
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}
