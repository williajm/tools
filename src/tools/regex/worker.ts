/**
 * Runs pattern evaluation off the main thread.
 *
 * The point is not speed, it is interruptibility. A pattern with catastrophic
 * backtracking cannot be stopped once `exec` has been entered, so the only way
 * to bound it is to run it somewhere that can be terminated — which is what the
 * caller does when a reply does not arrive in time.
 *
 * Loaded as a module worker from the site's own origin, so `script-src 'self'`
 * permits it. A blob: worker would not be allowed, which is why this is a real
 * file rather than a generated URL.
 */
import { EMPTY_EVALUATION, evaluate, type EvaluateRequest, type Evaluation } from './regex.ts';

export interface WorkerRequest {
  id: number;
  request: EvaluateRequest;
}

export interface WorkerResponse {
  id: number;
  evaluation: Evaluation;
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, request } = event.data;
  let evaluation: Evaluation;
  try {
    evaluation = evaluate(request);
  } catch (err) {
    // A throw here is a bug rather than bad input, since evaluate() reports
    // compile failures in its result. Report it instead of dying silently and
    // leaving the caller to time out.
    evaluation = { ...EMPTY_EVALUATION, error: err instanceof Error ? err.message : String(err) };
  }
  const response: WorkerResponse = { id, evaluation };
  self.postMessage(response);
});
