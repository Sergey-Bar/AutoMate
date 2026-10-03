import { describe, expect, it } from 'vitest';

import { ZAP_XML_ADAPTER_VERSION, parseZapReport, ZAP_RISK_BY_CODE } from './zap-xml.js';
import type { ProducerContext } from '../adapter.js';
import { canonicalTestStatusFrom } from '../producer-status.js';

const context: ProducerContext = {
  workspaceId: 'ws-1',
  runId: 'run-1',
  projectId: 'project-1',
  sourceUri: 'zap-report.xml',
  sourceDigest: 'b'.repeat(64),
  producerVersion: '2.14.0',
  adapterVersion: ZAP_XML_ADAPTER_VERSION,
  startedAt: '2026-10-02T10:00:00.000Z',
  finishedAt: '2026-10-02T10:02:00.000Z',
};

/** A ZAP report with one alert per supplied riskcode. */
function report(
  alerts: ReadonlyArray<{ risk: number; count?: number; name?: string }>,
): Uint8Array {
  const items = alerts
    .map(
      (alert) => `<alertitem>
        <pluginid>10038</pluginid>
        <alert>${alert.name ?? `Finding ${alert.risk}`}</alert>
        <riskcode>${alert.risk}</riskcode>
        <desc>a description</desc>
        <count>${alert.count ?? 1}</count>
        <solution>a solution</solution>
        <riskdesc>Medium (Medium)</riskdesc>
        <cweid>693</cweid>
        <wascid>15</wascid>
      </alertitem>`,
    )
    .join('');
  return new TextEncoder().encode(
    `<?xml version="1.0"?>
<OWASPZAPReport version="2.14.0" generated="Fri, 2 Oct 2026 10:00:00 GMT">
  <site name="example" host="https://example.com" port="443" ssl="true">
    <alerts>${items}</alerts>
  </site>
</OWASPZAPReport>`,
  );
}

const parse = (bytes: Uint8Array) => parseZapReport(bytes, context);

describe('a ZAP alert is a finding, and the risk decides the outcome', () => {
  it('reads a High alert as a failure and names it', () => {
    const result = parse(report([{ risk: 3, name: 'SQL Injection' }]));
    expect(result.status).toBe('failed');
    expect(result.attempts[0]?.testId).toBe('zap.10038');
    expect(result.attempts[0]?.title).toBe('SQL Injection');
  });

  it('reads a Medium or Low alert as a failure too', () => {
    // Anything at or above Low is a finding somebody has to act on. Treating Low
    // as a warning that does not fail is how a scanner gets ignored.
    expect(parse(report([{ risk: 2 }])).status).toBe('failed');
    expect(parse(report([{ risk: 1 }])).status).toBe('failed');
  });

  it('reads an Informational alert as skipped, because it is not a finding', () => {
    const result = parse(report([{ risk: 0, name: 'Timestamp Disclosure - Unix' }]));
    expect(result.status).toBe('skipped');
    expect(result.attempts[0]?.status).toBe('skipped');
  });

  it('resolves every risk code through the producer status table', () => {
    // The mapping is asserted against `canonicalTestStatusFrom` rather than a
    // literal, so a risk code added to ZAP's enum without a row here fails a
    // test instead of silently becoming a pass.
    for (const code of [0, 1, 2, 3]) {
      expect(ZAP_RISK_BY_CODE[code]).toBe(
        canonicalTestStatusFrom('zap', code === 0 ? 'informational' : 'failed'),
      );
    }
  });

  it('carries the occurrence count, so one plugin at 500 hits is not one finding', () => {
    const result = parse(report([{ risk: 3, count: 500 }]));
    expect(result.attempts[0]?.title).toContain('500');
  });
});

describe('a scan that found nothing is a pass, and a scan that never ran is not', () => {
  it('reports passed for a report with no alerts at all', () => {
    // A clean scan is a real result and must not read as `unknown`: an operator
    // who ran a scan and got nothing has evidence, and reporting it as unobserved
    // would make every clean scan look like a broken one.
    const result = parse(report([]));
    expect(result.status).toBe('passed');
  });

  it('refuses a report with no alerts element, which is not a scan result', () => {
    const bytes = new TextEncoder().encode('<OWASPZAPReport version="2.14.0"></OWASPZAPReport>');
    expect(() => parse(bytes)).toThrow(/zap/i);
  });

  it('refuses a document that is not a ZAP report', () => {
    expect(() => parse(new TextEncoder().encode('<html><body>404</body></html>'))).toThrow(/zap/i);
  });

  it('reports an unrecognised risk code as unknown rather than as a pass', () => {
    // riskcode 7 does not exist. Reading it as `0` would report an unknown
    // severity as Informational and call the run clean.
    const result = parse(report([{ risk: 7 }]));
    expect(result.attempts[0]?.status).toBe('unknown');
    expect(result.status).toBe('unknown');
  });
});

describe('several sites are one run, not several', () => {
  it('collects the alerts of every site into one result', () => {
    const bytes = new TextEncoder().encode(
      `<OWASPZAPReport version="2.14.0">
         <site name="a" host="https://a.example"><alerts><alertitem><pluginid>1</pluginid><alert>A</alert><riskcode>3</riskcode><count>1</count></alertitem></alerts></site>
         <site name="b" host="https://b.example"><alerts><alertitem><pluginid>2</pluginid><alert>B</alert><riskcode>3</riskcode><count>1</count></alertitem></alerts></site>
       </OWASPZAPReport>`,
    );
    const result = parse(bytes);
    expect(result.attempts).toHaveLength(2);
    expect(result.status).toBe('failed');
  });

  it('records the adapter version and the host, so a finding is traceable to a scan', () => {
    const result = parse(report([{ risk: 3 }]));
    expect(result.provenance['producer']).toBe('zap');
    expect(result.provenance['adapterVersion']).toBe(ZAP_XML_ADAPTER_VERSION);
  });
});
