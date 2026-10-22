/**
 * A small Dockerfile reader: enough to split a file into its build stages.
 *
 * `scripts/lib/dockerfile-contract.test.mjs` uses it to assert that a runtime stage
 * receives only a production deploy. Line continuations are kept inside the stage body
 * as written; the assertions match on whole instructions.
 */

/**
 * @typedef {{ name: string, from: string, body: string }} Stage
 */

/**
 * The stages of a Dockerfile, in order.
 *
 * @param {string} text
 * @returns {Stage[]}
 */
export function stages(text) {
  /** @type {Stage[]} */
  const found = [];
  for (const line of text.split(/\r?\n/)) {
    // Tokens rather than one pattern: `FROM image [AS name]`, case-insensitive keywords.
    const tokens = line.trim().split(/\s+/);
    if ((tokens[0] ?? '').toUpperCase() === 'FROM' && tokens.length >= 2) {
      const named = (tokens[2] ?? '').toUpperCase() === 'AS';
      found.push({
        name: named ? (tokens[3] ?? String(found.length)) : String(found.length),
        from: tokens[1] ?? '',
        body: '',
      });
      continue;
    }
    const current = found.at(-1);
    if (current !== undefined) current.body += `${line}\n`;
  }
  return found;
}

/**
 * The stage the image runs.
 *
 * @param {string} text
 * @returns {Stage}
 */
export function finalStage(text) {
  const all = stages(text);
  const last = all.at(-1);
  if (last === undefined) throw new Error('a Dockerfile with no FROM has no final stage');
  return last;
}
