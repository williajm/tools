import { saveBlob } from '../lib/download.ts';

interface Props {
  /** File contents. An empty value disables the button. */
  value: string;
  filename: string;
  /** MIME type, e.g. `text/plain`. */
  type: string;
  label?: string;
}

/** Saves `value` as a text file. */
export function DownloadButton({ value, filename, type, label = 'Download' }: Props) {
  return (
    <button type="button" onClick={() => saveBlob(new Blob([value], { type }), filename)} disabled={!value}>
      {label}
    </button>
  );
}
