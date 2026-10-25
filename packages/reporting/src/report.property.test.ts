import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  composeReport,
  escapeTelegramHtml,
  renderPlain,
  renderSlack,
  renderTelegram,
  type ReportInput,
} from './report.js';

/**
 * Property suite for DIGEST-1 and DIGEST-2 in `docs/quality/property-invariants.json`.
 *
 * Fixed seed and `numRuns`, so a red run reproduces on any host. The inputs are hostile on
 * purpose: arbitrary unicode including `&`, `<`, `>`, quotes and pipes, long titles, many
 * items, and links that may or may not be URLs.
 */
const SEED = 20261025;
const params = { seed: SEED, numRuns: 300 } as const;

const hostile = fc.string({
  unit: fc.oneof(
    fc.constantFrom('&', '<', '>', '"', '|', '*', '_', '\n', ' '),
    fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 }),
    fc.constantFrom('🔴', 'é', '中'),
  ),
  maxLength: 400,
});

const input: fc.Arbitrary<ReportInput> = fc.record({
  title: hostile,
  runs: fc.nat({ max: 10_000 }),
  passRate: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
  attention: fc.array(
    fc.record({ severity: fc.constantFrom('bad' as const, 'caution' as const), text: hostile }),
    { maxLength: 8 },
  ),
  digest: fc.array(
    fc.record({
      kind: fc.constantFrom('new-flaky' as const, 'pass-rate' as const, 'coverage' as const),
      tone: fc.constantFrom('good' as const, 'bad' as const),
      text: hostile,
    }),
    { maxLength: 8 },
  ),
  link: fc.option(fc.oneof(fc.webUrl(), hostile, fc.constant('https://a.test/x|y>z<w')), {
    nil: null,
  }),
});

const limit = fc.integer({ min: 80, max: 5_000 });

/**
 * The checker DIGEST-2 rests on: once the renderer's own tags are taken out, no `<` or `>`
 * is left, and every `&` begins one of the three entities the escaper writes.
 */
function markupIsSound(text: string, ownTags: RegExp): boolean {
  const stripped = text.replace(ownTags, '');
  if (/[<>]/u.test(stripped)) return false;
  return !/&(?!amp;|lt;|gt;|quot;)/u.test(stripped);
}

const TELEGRAM_TAGS = /<\/?b>|<a href="[^"<>]*">|<\/a>/gu;
const SLACK_TAGS = /<https?:\/\/[^|<>\s]*\|Open the dashboard>/gu;

describe('DIGEST-1: every rendering fits its platform limit', () => {
  it('holds for Telegram, Slack and plain text, at any limit', () => {
    fc.assert(
      fc.property(input, limit, (raw, max) => {
        const model = composeReport(raw);
        expect(renderTelegram(model, max).length).toBeLessThanOrEqual(max);
        expect(renderSlack(model, max).length).toBeLessThanOrEqual(max);
        expect(renderPlain(model, max).length).toBeLessThanOrEqual(max);
      }),
      params,
    );
  });

  it('never shows more than three items', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const model = composeReport(raw);
        expect(model.items.length).toBeLessThanOrEqual(3);
        expect(model.items.length + model.more).toBe(raw.attention.length + raw.digest.length);
      }),
      params,
    );
  });
});

describe('DIGEST-2: escaping is never broken, including by truncation', () => {
  it('leaves no stray markup in Telegram HTML or Slack mrkdwn', () => {
    fc.assert(
      fc.property(input, limit, (raw, max) => {
        const model = composeReport(raw);
        expect(markupIsSound(renderTelegram(model, max), TELEGRAM_TAGS)).toBe(true);
        expect(markupIsSound(renderSlack(model, max), SLACK_TAGS)).toBe(true);
      }),
      params,
    );
  });

  it('pins the inputs that found real cuts', () => {
    // An entity cut in half by a byte limit, and a link carrying Slack's own delimiters.
    const examples: ReportInput[] = [
      { title: '&&&&', runs: 1, passRate: 1, attention: [], digest: [], link: null },
      {
        title: 't',
        runs: 1,
        passRate: null,
        attention: [],
        digest: [],
        link: 'https://a.test/x|y>z<w',
      },
    ];
    for (const example of examples) {
      const model = composeReport(example);
      for (const max of [80, 81, 82, 83, 84]) {
        expect(markupIsSound(renderTelegram(model, max), TELEGRAM_TAGS)).toBe(true);
        expect(markupIsSound(renderSlack(model, max), SLACK_TAGS)).toBe(true);
      }
    }
  });
});

describe('the property harness can fail', () => {
  it('the checker refutes a renderer that does not escape', () => {
    // A harness that cannot fail is not evidence: an unescaped `<` must be caught.
    const naive = (text: string) => `<b>${text}</b>`;
    expect(markupIsSound(naive('Run <#812>'), TELEGRAM_TAGS)).toBe(false);
    expect(markupIsSound(naive('a & b'), TELEGRAM_TAGS)).toBe(false);
    expect(markupIsSound(`<b>${escapeTelegramHtml('Run <#812> & b')}</b>`, TELEGRAM_TAGS)).toBe(
      true,
    );
  });
});
