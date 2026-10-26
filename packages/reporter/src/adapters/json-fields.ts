/**
 * Field readers for parsed producer JSON.
 *
 * Every adapter in this directory walks a document it did not write, so every
 * field is `unknown` until one of these narrows it. They were copied into ten
 * adapters byte for byte; one copy means a change to what counts as "a string"
 * changes every adapter at once rather than whichever one was edited.
 *
 * Each reader returns an empty value (`null` or `[]`) rather than throwing: the
 * adapter decides whether a missing field is malformed input or merely absent.
 */

/** A JSON object, with its fields still unchecked. */
export type Json = Record<string, unknown>;

/** `value` as a JSON object, or `null` for an array, a primitive, or `null`. */
export function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

/** `value` as an array, or `[]` for anything else. */
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `value` as a non-empty string, or `null`. An empty string carries nothing. */
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `value` as a finite number, or `null` for `NaN`, `±Infinity` and non-numbers. */
export function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The non-empty strings in `values`, in order; anything else is dropped. */
export function strings(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
