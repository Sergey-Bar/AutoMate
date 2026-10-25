import { describe, expect, it } from 'vitest';
import {
  composeReport,
  renderPlain,
  renderSlack,
  renderTeams,
  renderTelegram,
  type ReportInput,
} from './report.js';

const BASE: ReportInput = {
  title: 'Weekly quality report',
  runs: 42,
  passRate: 97.14,
  attention: [],
  digest: [],
  link: 'https://automate.local:8443/dashboard/now',
};

describe('composeReport', () => {
  it('is green with nothing to report, and says what ran', () => {
    const model = composeReport(BASE);
    expect(model).toMatchObject({
      status: 'good',
      emoji: '🟢',
      sentence: '97.1% passed across 42 runs.',
      items: [],
      more: 0,
    });
  });

  it('puts the worst first, keeps three, and counts the rest', () => {
    const model = composeReport({
      ...BASE,
      digest: [
        { kind: 'pass-rate', tone: 'good', text: 'Pass rate +2.0 pts' },
        { kind: 'new-flaky', tone: 'bad', text: '2 new flaky tests' },
      ],
      attention: [
        { severity: 'caution', text: 'checkout-api grade fell to C' },
        { severity: 'bad', text: 'Run #812 failed: 3 tests' },
      ],
    });
    expect(model.status).toBe('bad');
    expect(model.items.map((item) => item.text)).toEqual([
      'Run #812 failed: 3 tests',
      '2 new flaky tests',
      'checkout-api grade fell to C',
    ]);
    expect(model.more).toBe(1);
  });

  it('is amber for bad news that needs no one right now, and green for neutral news', () => {
    const model = composeReport({
      ...BASE,
      digest: [{ kind: 'coverage', tone: 'bad', text: 'Coverage -1.2 pts' }],
    });
    expect(model.status).toBe('caution');
    const quiet = composeReport({
      ...BASE,
      digest: [
        { kind: 'pass-rate', tone: 'good', text: 'Pass rate +1.0 pts' },
        { kind: 'runs', tone: 'neutral', text: '42 runs, up from 30' },
      ],
    });
    expect(quiet.status).toBe('good');
    // Neutral news sits after warnings and before good news, with its own plain bullet.
    expect(quiet.items.map((item) => item.tone)).toEqual(['neutral', 'good']);
    expect(renderPlain(quiet)).toContain('• 42 runs, up from 30');
  });

  it('says when nothing ran, and when the pass rate is unknown', () => {
    expect(composeReport({ ...BASE, runs: 0, passRate: null }).sentence).toBe(
      'Nothing ran in this period.',
    );
    expect(composeReport({ ...BASE, runs: 1, passRate: null }).sentence).toBe(
      '1 run in this period.',
    );
  });

  it('links only an http(s) URL', () => {
    expect(composeReport({ ...BASE, link: 'javascript:alert(1)' }).link).toBeNull();
    expect(composeReport({ ...BASE, link: 'not a url' }).link).toBeNull();
    expect(composeReport({ ...BASE, link: null }).link).toBeNull();
  });
});

const NEWSY = composeReport({
  ...BASE,
  attention: [{ severity: 'bad', text: 'Run <#812> failed & 3 tests "broke"' }],
  digest: [{ kind: 'new-flaky', tone: 'bad', text: '2 new flaky tests' }],
});

describe('the renderers', () => {
  it('Slack: bold title, escaped text, one link', () => {
    expect(renderSlack(NEWSY)).toBe(
      [
        '*🔴 Weekly quality report*',
        '97.1% passed across 42 runs.',
        '🔴 Run &lt;#812&gt; failed &amp; 3 tests "broke"',
        '🔴 2 new flaky tests',
        '<https://automate.local:8443/dashboard/now|Open the dashboard>',
      ].join('\n'),
    );
  });

  it('Telegram: HTML with the same escaping and a real anchor', () => {
    expect(renderTelegram(NEWSY)).toBe(
      [
        '<b>🔴 Weekly quality report</b>',
        '97.1% passed across 42 runs.',
        '🔴 Run &lt;#812&gt; failed &amp; 3 tests "broke"',
        '🔴 2 new flaky tests',
        '<a href="https://automate.local:8443/dashboard/now">Open the dashboard</a>',
      ].join('\n'),
    );
  });

  it('WhatsApp and Signal: plain text, the link last', () => {
    expect(renderPlain(NEWSY)).toBe(
      [
        '🔴 Weekly quality report',
        '97.1% passed across 42 runs.',
        '🔴 Run <#812> failed & 3 tests "broke"',
        '🔴 2 new flaky tests',
        'https://automate.local:8443/dashboard/now',
      ].join('\n'),
    );
  });

  it('Teams: an Adaptive Card with a title block and an open-URL action', () => {
    const card = renderTeams(composeReport({ ...BASE, digest: [], attention: [] }));
    const content = card.attachments[0]?.content as {
      body: Array<{ text: string; weight?: string }>;
      actions: Array<{ url: string }>;
    };
    expect(content.body[0]).toMatchObject({ text: '🟢 Weekly quality report', weight: 'Bolder' });
    expect(content.actions[0]?.url).toBe('https://automate.local:8443/dashboard/now');
    expect(
      'actions' in
        (renderTeams(composeReport({ ...BASE, link: null })).attachments[0]?.content ?? {}),
    ).toBe(false);
  });

  it('says how many more there are', () => {
    const many = composeReport({
      ...BASE,
      attention: Array.from({ length: 5 }, (_, index) => ({
        severity: 'bad' as const,
        text: `Run ${String(index)} failed`,
      })),
    });
    expect(renderPlain(many)).toContain('+2 more');
  });

  it('trims a line that does not fit on its raw text, never inside an entity', () => {
    const long = composeReport({
      ...BASE,
      link: null,
      attention: [{ severity: 'bad', text: '&'.repeat(200) }],
    });
    const text = renderTelegram(long, 120);
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text).toMatch(/(&amp;)+…$/u);
    expect(renderSlack(long, 120).length).toBeLessThanOrEqual(120);
    expect(renderPlain(long, 80).length).toBeLessThanOrEqual(80);
  });

  it('drops the link before it would break the limit', () => {
    const tiny = composeReport({ ...BASE, link: `https://example.com/${'x'.repeat(200)}` });
    expect(renderPlain(tiny, 100).length).toBeLessThanOrEqual(100);
    expect(renderTelegram(tiny, 100).length).toBeLessThanOrEqual(100);
    expect(renderSlack(tiny, 100).length).toBeLessThanOrEqual(100);
  });
});
