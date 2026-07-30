import { useEffect, useRef, useState } from 'preact/hooks';
import { EMPTY_EVALUATION, evaluate, type EvaluateRequest, type Evaluation } from './regex.ts';
import type { WorkerRequest, WorkerResponse } from './worker.ts';

/**
 * How long a pattern gets before it is abandoned.
 *
 * Long enough that a large input on a slow machine still finishes, short enough
 * that a runaway pattern does not look like a hang. Anything legitimate on the
 * scale this tool is used at returns in single-digit milliseconds.
 */
const TIMEOUT_MS = 2000;

export type Status = 'ready' | 'running' | 'timeout';

export interface Result {
  evaluation: Evaluation;
  status: Status;
}

/**
 * Evaluates a pattern on a worker thread, with a time limit.
 *
 * A regex is not interruptible, so `(a+)+$` against a non-matching string would
 * freeze the tab — and because the inputs live in the URL fragment, a shared link
 * could freeze someone else's. Running it on a worker means the only remedy that
 * exists, terminating the thread, is available.
 *
 * The previous result stays on screen while a new one computes, so ordinary
 * typing does not flicker. Where workers are unavailable this falls back to
 * evaluating inline, which is the old behaviour: no time limit, but a correct
 * answer beats no answer.
 */
export function useEvaluation(request: EvaluateRequest): Result {
  const [result, setResult] = useState<Result>({ evaluation: EMPTY_EVALUATION, status: 'ready' });

  const worker = useRef<Worker | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const nextId = useRef(0);
  // Replies for superseded requests are discarded, so a slow answer to an old
  // keystroke cannot overwrite a newer one.
  const pending = useRef(0);
  const supported = useRef(typeof Worker !== 'undefined');

  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current);
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!supported.current) {
      setResult({ evaluation: evaluate(request), status: 'ready' });
      return;
    }

    if (!worker.current) {
      try {
        worker.current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      } catch {
        // Blocked or unsupported — evaluate inline from here on.
        supported.current = false;
        setResult({ evaluation: evaluate(request), status: 'ready' });
        return;
      }
    }

    const active = worker.current;
    const id = ++nextId.current;
    pending.current = id;

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== pending.current) return;
      window.clearTimeout(timer.current);
      setResult({ evaluation: event.data.evaluation, status: 'ready' });
    };
    active.addEventListener('message', onMessage);

    setResult((previous) => ({ ...previous, status: 'running' }));

    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // The thread is wedged inside a regex and will not respond, so nothing
      // short of terminating it will do. The next request builds a fresh one.
      active.terminate();
      if (worker.current === active) worker.current = null;
      setResult({ evaluation: EMPTY_EVALUATION, status: 'timeout' });
    }, TIMEOUT_MS);

    const message: WorkerRequest = { id, request };
    active.postMessage(message);

    return () => active.removeEventListener('message', onMessage);
  }, [request.pattern, request.flags, request.input, request.tests, request.replacement]);

  return result;
}
