import { describe, expect, it } from 'vitest';

import { artifactKind } from './artifact-kind.js';

describe('a report is named by the contract id, whichever way the producer spelled the file', () => {
  it('reads every name each producer actually writes', () => {
    // Not the format ids — the filenames. `junit.xml`, `junit-1.xml` and `junit.xml.part`
    // are all what a build leaves on disk, and an equality test recognises one of the three
    // and files the other two as generic evidence.
    expect(artifactKind('/w/junit.xml')).toBe('junit-xml');
    expect(artifactKind('/w/results/junit-1.xml')).toBe('junit-xml');
    expect(artifactKind('playwright-report.json')).toBe('playwright-json');
    expect(artifactKind('/w/k6-summary.json')).toBe('k6-json');
    expect(artifactKind('/w/ZAP-report.XML')).toBe('zap-xml');
  });

  it('does not let one producer marker answer for another', () => {
    // The markers are substrings, so this is the arm that says the ordering matters:
    // `zap-report.xml` must not be recognised as JUnit just because both are XML.
    expect(artifactKind('/w/k6.json')).not.toBe('zap-xml');
    expect(artifactKind('/w/junit.json')).not.toBe('k6-json');
    // A marker with the wrong extension is not that report.
    expect(artifactKind('/w/playwright-report.xml')).not.toBe('playwright-json');
  });
});

describe('a non-report artifact keeps the label only the runner uses', () => {
  it('labels by extension, and by name where the name is the whole signal', () => {
    expect(artifactKind('/w/shot.png')).toBe('screenshot');
    expect(artifactKind('/w/clip.webm')).toBe('video');
    expect(artifactKind('/w/trace.zip')).toBe('trace');
    expect(artifactKind('/w/events.ndjson')).toBe('event-log');
    expect(artifactKind('/w/report.html')).toBe('html-report');
    expect(artifactKind('/w/stdout.log')).toBe('stdout');
    expect(artifactKind('/w/stderr.log')).toBe('stderr');
  });

  it('sends a coverage report to the coverage adapter rather than to a test-result adapter', () => {
    // Coverage is XML, so the report branch is reached first; what keeps it out of
    // `junit-xml` is that no coverage producer's name is a marker there. This asserts the
    // branch exists rather than that it happens to fall through.
    expect(artifactKind('/w/cobertura-coverage.xml')).toBe('coverage');
    expect(artifactKind('/w/lcov.info')).toBe('coverage');
  });

  it('labels anything else evidence, which is the honest answer', () => {
    expect(artifactKind('/w/results.bin')).toBe('evidence');
    expect(artifactKind('/w/notes')).toBe('evidence');
  });
});
