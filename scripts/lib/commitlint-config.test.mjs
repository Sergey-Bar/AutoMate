// The body-length rule in `.config/commitlint.config.js`: 100 characters for every commit,
// except the bodies Dependabot generates, which name each directory it touched on one line
// and cannot be configured shorter. Header and scope rules still apply to Dependabot.
import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../../.config/commitlint.config.js';

const RULE = 'body-max-line-length-unless-dependabot';
const LONG =
  'Bumps the docker-minor-and-patch group with 1 update in the /infra/runners/zap directory: zaproxy/zaproxy.';
const DEPENDABOT_TRAILER = 'Signed-off-by: dependabot[bot] <support@github.com>';

/** @param {string} body @param {string} [trailer] */
function parsed(body, trailer) {
  const header = 'chore(deps): bump the docker-minor-and-patch group';
  const raw = [header, '', body, ...(trailer === undefined ? [] : ['', trailer])].join('\n');
  return { header, body, footer: trailer ?? null, raw };
}

/** @returns {(parsed: { body?: string | null, raw?: string }, when?: string, value?: number) => [boolean, string?]} */
function rule() {
  const plugin = (config.plugins ?? []).find((p) => p.rules?.[RULE] !== undefined);
  assert.ok(plugin, `the config defines ${RULE}`);
  return plugin.rules[RULE];
}

test('the built-in body-length rule is replaced, not left beside the new one', () => {
  assert.deepEqual(config.rules['body-max-line-length'], [0]);
  assert.deepEqual(config.rules[RULE], [2, 'always', 100]);
});

test('a human commit with a body line over 100 characters fails', () => {
  assert.ok(LONG.length > 100);
  const [valid] = rule()(parsed(LONG), 'always', 100);
  assert.equal(valid, false);
});

test('a body of lines at the limit passes', () => {
  const [valid] = rule()(parsed('x'.repeat(100)), 'always', 100);
  assert.equal(valid, true);
});

test("a Dependabot commit's generated body passes whatever its line length", () => {
  const [valid] = rule()(parsed(LONG, DEPENDABOT_TRAILER), 'always', 100);
  assert.equal(valid, true);
});

test('the exemption needs the exact trailer, not the word dependabot anywhere', () => {
  const [valid] = rule()(parsed(`${LONG} dependabot[bot]`), 'always', 100);
  assert.equal(valid, false);
  const [quoted] = rule()(parsed(`${LONG}\n  ${DEPENDABOT_TRAILER}`), 'always', 100);
  assert.equal(quoted, false);
});

test('a commit with no body passes', () => {
  const [valid] = rule()({ body: null, raw: 'fix(api): x' });
  assert.equal(valid, true);
});
