/**
 * A semgrep probe fixture for the browser rules. Not application code and never
 * executed.
 *
 * Scanned as `apps/web/src/probe.ts` relative to `.semgrep-probe`, so the
 * `paths.include` in `no-eval-in-client` and `no-string-set-timeout` applies to
 * it. These two rules are the ones that were rewritten into silence, and the one
 * that *did* fire had 27 of its 30 findings on `setTimeout(handler, ms)` — so the
 * safe twin is here too, to prove the rule reports the hazard rather than the
 * shape.
 */

/* eslint-disable */
declare const value: unknown;
declare const next: string;

/** HAZARD: a function value is executed as readily as a string. */
export function hazardEvalFunction() {
  return eval(value);
}

/** HAZARD: `new Function` compiles a string into code. */
export function hazardNewFunction() {
  return new Function('return 1');
}

/** HAZARD: the browser evaluates a string argument to setTimeout as code. */
export function hazardStringSetTimeout() {
  setTimeout('location.href = next', 100);
}

/** HAZARD: `setInterval` has the same evaluation rule. */
export function hazardStringSetInterval() {
  setInterval('poll()', 1000);
}

/** SAFE: a timer. Reporting this was 27 of the rule's first 30 findings. */
export function safeFunctionSetTimeout() {
  setTimeout(() => {
    void next;
  }, 100);
}

/** SAFE: a module-scoped import is not a caller-supplied URL. */
export function safeCredentialStorage() {
  return localStorage.setItem('theme', 'dark');
}
