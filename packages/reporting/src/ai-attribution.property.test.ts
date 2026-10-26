import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AGENT_SIGNATURES,
  classifyAttribution,
  parseTrailers,
  type AgentSignature,
  type AttributionOptions,
  type AttributionResult,
  type AttributionSubject,
} from './ai-attribution.js';

/**
 * Property suite for ATTR-1 and ATTR-2.
 *
 * ATTR-1: adding a matching signal never lowers confidence.
 * ATTR-2: a subject with no author identity and no signal is never `human`.
 *
 * Fixed seed and `numRuns`, so a red run reproduces on any host. Subjects mix arbitrary
 * text with real signature fragments, so the generator reaches the interesting overlaps
 * (a trailer already present, a bot author plus an agent branch) and not only clean input.
 */
const SEED = 20261026;
const params = { seed: SEED, numRuns: 400 } as const;

const ENTRIES = AGENT_SIGNATURES.entries as readonly AgentSignature[];

function entryFor(pattern: string): AgentSignature {
  const entry = ENTRIES.find((candidate) => candidate.pattern === pattern);
  if (entry === undefined) throw new Error(`no signature ${pattern}`);
  return entry;
}

const fragment = fc.oneof(
  fc.string({ maxLength: 30 }),
  fc.constantFrom(
    'Copilot',
    'dependabot[bot]',
    'codex/x',
    'Co-authored-by: Claude <noreply@anthropic.com>',
    'Made-with: Cursor',
    'fix: x',
    '\n\n',
    'aider: ',
    ' (aider)',
  ),
);
const optionalText = fc.option(fragment, { nil: null });
const message = fc.option(
  fc.array(fragment, { maxLength: 5 }).map((parts) => parts.join('')),
  { nil: null },
);

const subject: fc.Arbitrary<AttributionSubject> = fc.record(
  {
    authorLogin: optionalText,
    authorEmail: fc.option(fc.oneof(fc.emailAddress(), fc.constant('cursoragent@cursor.com')), {
      nil: null,
    }),
    authorName: optionalText,
    committerLogin: optionalText,
    message,
    branch: optionalText,
    labels: fc.array(fc.constantFrom('ai', 'agent', 'bug'), { maxLength: 3 }),
    notes: optionalText,
  },
  { requiredKeys: [] },
);

const options: fc.Arbitrary<AttributionOptions> = fc.record({
  agentLabels: fc.constantFrom([], ['agent']),
  assistedLabels: fc.constantFrom([], ['ai']),
});

/** Append a trailer without disturbing the trailers already in the final paragraph. */
function withTrailer(text: string | null | undefined, line: string): string {
  // A blank message has no subject for the trailer to follow, and git would read the
  // lone trailer as the subject: give it one.
  const base = text === null || text === undefined || text.trim() === '' ? 'subject' : text;
  const hasTrailerBlock = parseTrailers(base).length > 0;
  return hasTrailerBlock ? `${base.replace(/\s+$/u, '')}\n${line}` : `${base.trimEnd()}\n\n${line}`;
}

/** A trailer line whose normalised form contains the entry's pattern. */
function trailerLine(pattern: string): string {
  return pattern.includes(':') ? pattern : `Co-authored-by: Agent <${pattern}>`;
}

type Injection =
  { kind: 'signature'; entry: AgentSignature } | { kind: 'label'; mode: 'agent' | 'assisted' };

/** Add one matching signal, touching only the field that carries it. */
function inject(
  base: AttributionSubject,
  baseOptions: AttributionOptions,
  injection: Injection,
): { subject: AttributionSubject; options: AttributionOptions } {
  if (injection.kind === 'label') {
    const label = `injected-${injection.mode}`;
    const key = injection.mode === 'agent' ? 'agentLabels' : 'assistedLabels';
    return {
      subject: { ...base, labels: [...(base.labels ?? []), label] },
      options: { ...baseOptions, [key]: [...(baseOptions[key] ?? []), label] },
    };
  }
  const { entry } = injection;
  const next: AttributionSubject = { ...base };
  switch (entry.kind) {
    case 'bot-login':
      next.authorLogin = entry.pattern;
      break;
    case 'trailer':
      next.message = withTrailer(base.message, trailerLine(entry.pattern));
      break;
    case 'branch-prefix':
      next.branch = `${entry.pattern}task`;
      break;
    case 'author-email':
      next.authorEmail = entry.pattern;
      break;
    case 'author-name':
      next.authorName = `${base.authorName ?? 'someone'} ${entry.pattern}`;
      break;
    case 'message-marker':
      next.notes = `${entry.pattern.replace(/^\^/u, '')} ${base.notes ?? ''}`;
      break;
  }
  return { subject: next, options: baseOptions };
}

const injection: fc.Arbitrary<Injection> = fc.oneof(
  fc.constantFrom(...ENTRIES).map((entry) => ({ kind: 'signature' as const, entry })),
  fc.constantFrom('agent' as const, 'assisted' as const).map((mode) => ({
    kind: 'label' as const,
    mode,
  })),
);

function attr1Holds(
  classify: (s: AttributionSubject, o: AttributionOptions) => AttributionResult,
  base: AttributionSubject,
  baseOptions: AttributionOptions,
  added: Injection,
): boolean {
  const before = classify(base, baseOptions);
  const after = inject(base, baseOptions, added);
  const result = classify(after.subject, after.options);
  return result.confidence >= before.confidence - 1e-12 && result.attribution !== 'human';
}

describe('ATTR-1: adding a matching signal never lowers confidence', () => {
  it('holds for every table entry and for configured labels', () => {
    fc.assert(
      fc.property(subject, options, injection, (base, baseOptions, added) => {
        expect(attr1Holds(classifyAttribution, base, baseOptions, added)).toBe(true);
      }),
      params,
    );
  });

  it('every injection is in fact a matching signal', () => {
    // Without this, ATTR-1 could pass vacuously on injections the classifier never sees.
    for (const entry of ENTRIES) {
      const { subject: injected } = inject({ authorName: 'x' }, {}, { kind: 'signature', entry });
      const result = classifyAttribution(injected);
      expect(result.signals.some((signal) => signal.detail.includes(entry.pattern))).toBe(true);
    }
  });

  it('pins the inputs that broke a naive injector', () => {
    // A trailer appended as a new paragraph would push existing trailers out of the
    // final paragraph; a marker appended to the message would do the same.
    const examples: [AttributionSubject, Injection][] = [
      [
        { authorName: 'x', message: 's\n\nCo-authored-by: Claude <noreply@anthropic.com>' },
        { kind: 'signature', entry: entryFor('generated with claude code') },
      ],
      [
        { authorName: 'x', message: 's\n\nCo-authored-by: Claude <noreply@anthropic.com>\n\n' },
        { kind: 'signature', entry: entryFor('made-with: cursor') },
      ],
      [{}, { kind: 'label', mode: 'assisted' }],
      // Found by this suite on seed 20261026: a trailer appended to an empty message
      // became the subject and was never read.
      [
        { authorEmail: 'a@a.aa', message: '' },
        { kind: 'signature', entry: entryFor('noreply@anthropic.com') },
      ],
      [{ authorLogin: 'dependabot[bot]' }, { kind: 'label', mode: 'agent' }],
    ];
    for (const [base, added] of examples) {
      expect(attr1Holds(classifyAttribution, base, {}, added)).toBe(true);
    }
  });
});

describe('ATTR-2: no author identity and no signal is never human', () => {
  const anonymous: fc.Arbitrary<AttributionSubject> = fc.record({
    authorLogin: fc.constantFrom(null, '', '   '),
    authorEmail: fc.constantFrom(null, '', '\t'),
    authorName: fc.constantFrom(null, ' '),
    committerLogin: optionalText,
    message,
    branch: optionalText,
    notes: optionalText,
  });

  it('holds', () => {
    fc.assert(
      fc.property(anonymous, (base) => {
        const result = classifyAttribution(base);
        expect(result.attribution).not.toBe('human');
        if (result.signals.length === 0) expect(result.attribution).toBe('unknown');
      }),
      params,
    );
  });

  it('pins the regressions', () => {
    for (const base of [{}, { authorLogin: '   ', message: 'fix: x' }, { branch: 'main' }]) {
      expect(classifyAttribution(base).attribution).toBe('unknown');
    }
  });
});

describe('the property harness can fail', () => {
  it('refutes a classifier that lowers confidence when it switches mode', () => {
    // Scoring only the winning mode's signals is the obvious way to write this, and it is
    // wrong: a weak agent branch would override a strong co-author trailer.
    const winningModeOnly = (s: AttributionSubject, o: AttributionOptions): AttributionResult => {
      const result = classifyAttribution(s, o);
      if (result.attribution !== 'agent-authored') return result;
      const agentKinds = result.signals.filter((signal) =>
        ENTRIES.some(
          (e) =>
            e.mode === 'agent-authored' &&
            e.kind === signal.kind &&
            signal.detail.includes(e.pattern),
        ),
      );
      return { ...result, confidence: agentKinds.length > 0 ? 0.6 : result.confidence };
    };
    const outcome = fc.check(
      fc.property(subject, options, injection, (base, baseOptions, added) =>
        attr1Holds(winningModeOnly, base, baseOptions, added),
      ),
      params,
    );
    expect(outcome.failed).toBe(true);
  });

  it('refutes a classifier that calls the anonymous human', () => {
    const optimistic = (s: AttributionSubject): AttributionResult => {
      const result = classifyAttribution(s);
      return result.attribution === 'unknown' ? { ...result, attribution: 'human' } : result;
    };
    const outcome = fc.check(
      fc.property(
        fc.constant<AttributionSubject>({}),
        (base) => optimistic(base).attribution !== 'human',
      ),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
