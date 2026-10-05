import { describe, expect, it } from 'vitest';

import {
  DETECTABLE_REPORT_FORMAT_IDS,
  REPORT_ENCODINGS,
  REPORT_FORMAT_IDS,
  REPORT_FORMATS,
  REPORT_PRODUCERS,
  ReportFormatIdSchema,
  ReportProducerSchema,
  reportFormatById,
  reportFormatForSpelling,
} from './report-formats.js';

describe('the format table is the vocabulary, so its shape has to hold', () => {
  it('gives every format a unique id, a real producer, and a real encoding', () => {
    const ids = REPORT_FORMATS.map((format) => format.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const format of REPORT_FORMATS) {
      expect(REPORT_PRODUCERS, `${format.id} names a producer outside the enum`).toContain(
        format.producer,
      );
      expect(REPORT_ENCODINGS, `${format.id} names an encoding outside the enum`).toContain(
        format.encoding,
      );
    }
  });

  it('keeps the zod schemas and the arrays in agreement', () => {
    // The arrays are what a caller reads; the schemas are what a payload is validated
    // against. If one is edited and not the other, a document is valid under a vocabulary
    // the code cannot look up — which is the failure this file was added to end.
    expect(REPORT_FORMAT_IDS).toEqual(REPORT_FORMATS.map((format) => format.id));
    expect(DETECTABLE_REPORT_FORMAT_IDS).toEqual(
      REPORT_FORMATS.filter((format) => format.detectable).map((format) => format.id),
    );
    for (const id of REPORT_FORMAT_IDS) expect(ReportFormatIdSchema.options).toContain(id);
    for (const producer of REPORT_PRODUCERS)
      expect(ReportProducerSchema.options).toContain(producer);
  });

  it('gives every declarable format a spelling, and no two formats the same one', () => {
    const seen = new Map<string, string>();
    for (const format of REPORT_FORMATS) {
      // A format nobody can declare is unreachable: the door keys on a declaration, and a
      // file-name guess is a fallback rather than a contract. `legacy-upload` is the one
      // deliberate exception — it is the shape a body with no declaration falls back to.
      if (format.spellings.length === 0) {
        expect(format.id).toBe('legacy-upload');
        continue;
      }
      for (const spelling of format.spellings) {
        expect(seen.get(spelling)).toBeUndefined();
        seen.set(spelling, format.id);
      }
    }
  });
});

describe('a spelling resolves to exactly one format', () => {
  it('accepts every spelling the table lists, in any case, with surrounding space', () => {
    for (const format of REPORT_FORMATS) {
      for (const spelling of format.spellings) {
        expect(reportFormatForSpelling(spelling)?.id, spelling).toBe(format.id);
        expect(reportFormatForSpelling(spelling.toUpperCase())?.id, spelling).toBe(format.id);
        expect(reportFormatForSpelling(`  ${spelling} `)?.id, spelling).toBe(format.id);
      }
    }
  });

  it('resolves the two formats the door could not reach before', () => {
    // The defect this table was added for: `k6` and `zap` were spelled nowhere the upload
    // door read, so a caller declaring its own format was routed to an adapter that could
    // not parse the document.
    expect(reportFormatForSpelling('k6')?.id).toBe('k6-json');
    expect(reportFormatForSpelling('k6-summary')?.id).toBe('k6-json');
    expect(reportFormatForSpelling('zap')?.id).toBe('zap-xml');
  });

  it('answers undefined for an empty or unknown declaration rather than guessing', () => {
    // `undefined` and `''` are the same answer on purpose: a newer producer's spelling has
    // to fall through to the caller's own fallback, not be refused and not match anything.
    for (const spelling of ['', '   ', 'junit5', 'playwrigt', 'not-a-format']) {
      expect(reportFormatForSpelling(spelling), spelling).toBeUndefined();
    }
  });

  it('looks an id up by the same ids it exports', () => {
    for (const id of REPORT_FORMAT_IDS) expect(reportFormatById(id)?.id).toBe(id);
    expect(reportFormatById('sarif')).toBeUndefined();
  });
});
