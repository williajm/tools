import type { ComponentChild } from 'preact';
import { render } from 'preact';
import './styles.css';

/** Every page entry point ends with this. Keeps per-tool main.tsx to two lines. */
export function mount(node: ComponentChild): void {
  const el = document.getElementById('app');
  if (!el) throw new Error('#app not found');
  render(node, el);
}
