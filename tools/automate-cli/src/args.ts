import { usage } from './errors.js';

/**
 * `--name value` and `--name=value` options, and `--flag` switches. Every option is declared
 * by the command that reads it, so a misspelt option is refused rather than ignored: a CI
 * step that silently dropped `--commit` would gate the wrong commit.
 */
export interface Parsed {
  values: Map<string, string>;
  switches: Set<string>;
}

export function parseOptions(
  argv: readonly string[],
  spec: { values: readonly string[]; switches?: readonly string[] },
): Parsed {
  const parsed: Parsed = { values: new Map<string, string>(), switches: new Set<string>() };
  const known = new Set(spec.values);
  const flags = new Set(spec.switches ?? []);
  let index = 0;
  while (index < argv.length) {
    index = readOne(argv, index, { known, flags }, parsed);
  }
  return parsed;
}

/** Reads the option at `index` into `parsed`, and answers the index of the next one. */
function readOne(
  argv: readonly string[],
  index: number,
  spec: { known: ReadonlySet<string>; flags: ReadonlySet<string> },
  parsed: Parsed,
): number {
  const token = argv[index] ?? '';
  if (!token.startsWith('--')) throw usage(`Unexpected argument: ${token}`);
  const [name = '', inline] = token.slice(2).split(/=(.*)/su, 2);
  if (spec.flags.has(name) && inline === undefined) {
    parsed.switches.add(name);
    return index + 1;
  }
  if (!spec.known.has(name)) throw usage(`Unknown option --${name}`);
  if (inline !== undefined) {
    parsed.values.set(name, inline);
    return index + 1;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw usage(`--${name} needs a value`);
  parsed.values.set(name, value);
  return index + 2;
}

export function required(parsed: Parsed, name: string, fallback?: string): string {
  const value = (parsed.values.get(name) ?? fallback ?? '').trim();
  if (value === '') throw usage(`--${name} is required`);
  return value;
}

export function optional(parsed: Parsed, name: string, fallback?: string): string | undefined {
  const value = (parsed.values.get(name) ?? fallback ?? '').trim();
  return value === '' ? undefined : value;
}
