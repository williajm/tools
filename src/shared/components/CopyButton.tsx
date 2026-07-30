import { useEffect, useState } from 'preact/hooks';

interface Props {
  value: string;
  label?: string;
  disabled?: boolean;
}

/** Copy-to-clipboard with transient confirmation. */
export function CopyButton({ value, label = 'Copy', disabled }: Props) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), 1400);
    return () => window.clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('done');
    } catch {
      // Clipboard API needs a secure context and permission; both can fail.
      setState('failed');
    }
  };

  return (
    <button type="button" onClick={copy} disabled={disabled || !value}>
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
