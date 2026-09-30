import { describe, expect, it } from 'vitest';
import {
  PROMETHEUS_CONTENT_TYPE,
  collect,
  recordRequest,
  renderExposition,
  requestCounterSamples,
  type Series,
} from './metrics.js';

/**
 * The exposition format, and the three promises the endpoint makes.
 *
 * The format assertions are written against the rendered text rather than against a
 * parser, because a test that used a parser would pass if the parser and the writer
 * shared a mistake. These strings are what a scraper reads, so they are compared as
 * strings.
 */
describe('the exposition format', () => {
  const series: Series[] = [
    {
      name: 'automate_thing_total',
      type: 'counter',
      help: 'Things that happened.',
      labels: { class: '2xx' },
      value: 7,
    },
    {
      name: 'automate_thing_total',
      type: 'counter',
      help: 'Things that happened.',
      labels: { class: '5xx' },
      value: 1,
    },
    { name: 'automate_gauge', type: 'gauge', help: 'A number.', labels: {}, value: 1.5 },
  ];

  it('emits HELP and TYPE once per metric name, before its first sample', () => {
    const body = renderExposition(series);
    expect(body.match(/# HELP automate_thing_total/g)).toHaveLength(1);
    expect(body.match(/# TYPE automate_thing_total/g)).toHaveLength(1);
    expect(body).toContain('# TYPE automate_gauge gauge');
    expect(body).toContain('automate_thing_total{class="2xx"} 7');
    expect(body).toContain('automate_thing_total{class="5xx"} 1');
  });

  it('omits the label braces entirely for a metric with no labels', () => {
    expect(renderExposition(series)).toContain('\nautomate_gauge 1.5');
  });

  it('ends with a newline, because the format is line-based', () => {
    // A body without one is a different body from every other, and a scraper that
    // splits on newlines drops the last sample.
    const body = renderExposition(series);
    expect(body.endsWith('\n')).toBe(true);
    expect(body.split('\n').at(-2)).toBe('automate_gauge 1.5');
    // An empty registry is an empty body, not a body with a blank line in it.
    expect(renderExposition([])).toBe('');
  });

  it('escapes a label value, so a value cannot forge a sample', () => {
    // The three escapes the format requires. A value carrying a newline would end the
    // sample and the rest of the value would be read as the next line — which is how a
    // string that came from a request becomes a metric the scraper trusts.
    const body = renderExposition([
      {
        name: 'automate_untrusted',
        type: 'gauge',
        help: 'A value that came from somewhere.',
        labels: { note: 'a"b\\c\nd' },
        value: 1,
      },
    ]);
    expect(body).toContain('automate_untrusted{note="a\\"b\\\\c\\nd"} 1');
    // And the injected second line is not there as a line of its own.
    expect(body.split('\n').filter((line) => line.startsWith('d'))).toHaveLength(0);
  });

  it('omits HELP and TYPE for a metric with no samples', () => {
    // An empty family with a HELP and nothing under it is a parse warning in every
    // downstream tool. Absence is how the format says "no data".
    expect(renderExposition([])).not.toContain('#');
  });
});

describe('the request counter', () => {
  it('counts by status class, with every class present whether or not it was hit', () => {
    const before = requestCounterSamples().map((sample) => sample.value);
    recordRequest(200);
    recordRequest(201);
    recordRequest(404);
    recordRequest(503);
    const after = requestCounterSamples();

    // A fixed shape is the difference between a metric you can alert on and one whose
    // series appear and disappear. A class nobody has hit is still reported, as 0.
    expect(after.map((sample) => sample.labels['class'])).toEqual([
      '1xx',
      '2xx',
      '3xx',
      '4xx',
      '5xx',
    ]);
    expect(after[1]?.value).toBe((before[1] ?? 0) + 2);
    expect(after[3]?.value).toBe((before[3] ?? 0) + 1);
    expect(after[4]?.value).toBe((before[4] ?? 0) + 1);
    expect(after[0]?.value).toBe(before[0] ?? 0);
  });

  it('drops a status it has no class for, rather than inventing one', () => {
    const before = requestCounterSamples().map((sample) => sample.value);
    // A handler cannot return 0 or 600, so either value is a bug in a handler, and
    // counting it under a plausible class would hide the bug behind a number.
    recordRequest(0);
    recordRequest(600);
    recordRequest(999);
    expect(requestCounterSamples().map((sample) => sample.value)).toEqual(before);
  });

  it('uses a _total suffix and the counter type, as the format requires', () => {
    for (const sample of requestCounterSamples()) {
      expect(sample.type).toBe('counter');
      expect(sample.name.endsWith('_total')).toBe(true);
    }
  });
});

describe('what the endpoint exposes, and what it does not', () => {
  it('states the content type the format requires', () => {
    expect(PROMETHEUS_CONTENT_TYPE).toBe('text/plain; version=0.0.4; charset=utf-8');
  });

  it('exposes process state and the request counter, and nothing derived from a run', () => {
    const names = collect().map((sample) => sample.name);
    expect(names).toContain('process_resident_memory_bytes');
    expect(names).toContain('process_heap_size_used_bytes');
    expect(names).toContain('process_uptime_seconds');
    expect(names).toContain('automate_http_requests_total');

    // The promises the module's header and the register row make. Asserted here because
    // the failure mode of a metrics endpoint is a *new* metric added for a good reason
    // and never reviewed for what it carries — a run id in a label is unbounded
    // cardinality, and a test title is the customer's data in a place nobody audited.
    for (const forbidden of ['run', 'test', 'suite', 'workspace', 'tenant', 'artifact']) {
      expect(
        names.filter((name) => name.includes(forbidden)),
        `a metric name mentions "${forbidden}", which the content decision rules out`,
      ).toEqual([]);
    }
    for (const sample of collect()) {
      for (const key of Object.keys(sample.labels)) {
        expect(['class']).toContain(key);
      }
    }
  });

  it('performs no query: collect() takes no arguments and is synchronous', () => {
    // A scrape is an unauthenticated GET, so a query in this path is a query anybody can
    // make repeatedly. `collect` returning a value synchronously is the type-level
    // statement of that, and it is checked here so the next collector cannot quietly
    // become async.
    expect(collect().length).toBeGreaterThan(0);
    expect(collect()).not.toBeInstanceOf(Promise);
  });
});
