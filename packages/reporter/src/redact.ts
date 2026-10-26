/**
 * The product's one secret redactor.
 *
 * Applied to any free text the product keeps from a source it does not control — today, the
 * prompt and completion content of a GenAI span, which is kept only when a project's policy
 * asks for it (`agents.storeTraceContent`). The other credential-shape lists do different
 * jobs and are not this one: the runner replaces the literal values it registered
 * (`apps/runner/src/execution.ts`, `sanitizeError`); `apps/api/src/infrastructure/outbox-sanitizer.ts`
 * classifies a whole outbox value as secret-or-not; the agent-config scanner in
 * `@automate/projects` reports labelled detections with placeholder heuristics; and
 * `scripts/secret-scan.mjs` is a dependency-free gate. `local/src/redact.mjs` belongs to the
 * standalone local tool, which is not a workspace package and cannot be imported from here.
 * The patterns below start from that tool's, add an `sk-` key shape, and bound the
 * private-key quantifiers.
 *
 * **Best effort by nature.** A pattern redactor misses credentials it does not recognise,
 * which is why content is not stored by default and why the policy that turns it on says so.
 */

export const REDACTED = '[redacted]';

/** Shapes of common credentials. Each is bounded, so none can backtrack without limit. */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/gu,
  /\bsk-[A-Za-z0-9_-]{20,}/gu,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*["']?[^\s"']{6,}/giu,
];

const KEY_BEGIN = /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/gu;
const KEY_END = /-----END [A-Z ]{0,40}PRIVATE KEY-----/gu;

/**
 * Every `BEGIN … PRIVATE KEY` to its next `END … PRIVATE KEY` replaced, in one forward pass.
 *
 * Not one lazy `BEGIN[\s\S]*?END` pattern: for every header with no end after it, that rescans
 * to the end of the input, which is quadratic in a text of many headers — and this runs on up
 * to 8 MiB of trace content. Here the search for an end starts where the header ends, a block
 * resumes the walk after its end, and once no end is left the walk stops: linear.
 */
function redactPrivateKeys(text: string): string {
  let out = '';
  let from = 0;
  KEY_BEGIN.lastIndex = 0;
  for (let begin = KEY_BEGIN.exec(text); begin !== null; begin = KEY_BEGIN.exec(text)) {
    KEY_END.lastIndex = KEY_BEGIN.lastIndex;
    const end = KEY_END.exec(text);
    if (end === null) break;
    out += `${text.slice(from, begin.index)}${REDACTED}`;
    from = KEY_END.lastIndex;
    KEY_BEGIN.lastIndex = from;
  }
  return out + text.slice(from);
}

/**
 * `text` with every literal in `registered` (four characters or more) and every credential
 * shape replaced by {@link REDACTED}.
 */
export function redactSecrets(text: string, registered: readonly string[] = []): string {
  let out = text;
  for (const value of registered) {
    if (value.length >= 4) out = out.replaceAll(value, REDACTED);
  }
  out = redactPrivateKeys(out);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}
