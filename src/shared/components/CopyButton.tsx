import { useEffect, useState } from 'preact/hooks';

interface Props {
  /** Text to copy, and what the button being enabled is keyed off. */
  value: string;
  label?: string;
  disabled?: boolean;
  /**
   * Overrides the copy itself, for putting something other than text on the
   * clipboard. `value` still governs the disabled state, so pass the source the
   * write derives from. The idle/copied/failed confirmation is shared either way.
   */
  write?: () => Promise<void>;
}

/** Copy-to-clipboard with transient confirmation. */
export function CopyButton({ value, label = 'Copy', disabled, write }: Props) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), 1400);
    return () => window.clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      if (write) await write();
      else await navigator.clipboard.writeText(value);
      setState('done');
    } catch {
      // Clipboard API needs a secure context and permission; both can fail. Image
      // writes additionally need ClipboardItem, which not every browser has.
      setState('failed');
    }
  };

  return (
    <button type="button" onClick={copy} disabled={disabled || !value}>
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
