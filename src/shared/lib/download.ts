/**
 * Hands `blob` to the browser as a download named `filename`. Everything stays
 * local: the object URL only exists in this page and is released once the
 * browser has taken the download over.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Not synchronously: some browsers abort a download whose URL is revoked
  // before they have started reading it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
