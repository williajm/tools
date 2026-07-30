interface Props<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  /** Optional display names, keyed by option value. */
  names?: Partial<Record<T, string>>;
}

/** Mode switcher used by the multi-mode tools. */
export function Segmented<T extends string>({ options, value, onChange, label, names }: Props<T>) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          aria-pressed={opt === value}
          onClick={() => onChange(opt)}
        >
          {names?.[opt] ?? opt}
        </button>
      ))}
    </div>
  );
}
