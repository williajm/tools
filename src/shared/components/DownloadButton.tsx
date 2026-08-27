interface Props {
  /** File contents. An empty value disables the button. */
  value: string;
  filename: string;
  /** MIME type, e.g. `text/plain`. */
  type: string;
  label?: string;
}

/**
 * Saves `value` as a file. Everything stays in the browser: the blob URL is
 * local to this page and is released once the download has been handed off.
 */
export function DownloadButton({ value, filename, type, label = 'Download' }: Props) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([value], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Not synchronously: some browsers abort a download whose URL is revoked
    // before they have started reading it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <button type="button" onClick={download} disabled={!value}>
      {label}
    </button>
  );
}
