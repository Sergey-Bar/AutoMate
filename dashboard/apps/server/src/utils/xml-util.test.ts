import { describe, it, expect } from 'vitest';
import { escapeXml, generateJUnitXml } from './xml-util.js';

describe('xml-util', () => {
  describe('escapeXml', () => {
    it('should escape XML special characters', () => {
      expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
      expect(escapeXml('a & b')).toBe('a &amp; b');
      expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;');
      expect(escapeXml("it's")).toBe('it&apos;s');
    });

    it('should handle all special characters together', () => {
      expect(escapeXml('<tag attr="value" & \'quoted\' >')).toBe(
        '&lt;tag attr=&quot;value&quot; &amp; &apos;quoted&apos; &gt;'
      );
    });

    it('should handle null and undefined', () => {
      expect(escapeXml(null)).toBe('');
      expect(escapeXml(undefined)).toBe('');
    });

    it('should convert non-string values to strings', () => {
      expect(escapeXml(123 as unknown as string)).toBe('123');
      expect(escapeXml(true as unknown as string)).toBe('true');
    });
  });

  describe('generateJUnitXml', () => {
    it('should generate valid JUnit XML for passing tests', () => {
      const suites = [
        {
          name: 'test/example.spec.ts',
          tests: [
            {
              name: 'should pass',
              classname: 'test/example.spec.ts',
              time: 1.234,
              status: 'passed' as const,
            },
            {
              name: 'should also pass',
              classname: 'test/example.spec.ts',
              time: 0.567,
              status: 'passed' as const,
            },
          ],
        },
      ];
      const xml = generateJUnitXml(suites);
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<testsuites>');
      expect(xml).toContain('</testsuites>');
      expect(xml).toContain('<testsuite name="test/example.spec.ts" tests="2" failures="0" skipped="0" time="1.801">');
      expect(xml).toContain('<testcase name="should pass" classname="test/example.spec.ts" time="1.234">');
      expect(xml).toContain('<testcase name="should also pass" classname="test/example.spec.ts" time="0.567">');
    });

    it('should include failure elements for failed tests', () => {
      const suites = [
        {
          name: 'test/failure.spec.ts',
          tests: [
            {
              name: 'should fail',
              classname: 'test/failure.spec.ts',
              time: 0.5,
              status: 'failed' as const,
              errorMessage: 'Expected 1 to equal 2',
              errorStack: 'at test/failure.spec.ts:10:5',
            },
          ],
        },
      ];
      const xml = generateJUnitXml(suites);
      expect(xml).toContain('<testsuite name="test/failure.spec.ts" tests="1" failures="1" skipped="0"');
      expect(xml).toContain('<failure message="Expected 1 to equal 2">at test/failure.spec.ts:10:5</failure>');
    });

    it('should include skipped elements for skipped tests', () => {
      const suites = [
        {
          name: 'test/skip.spec.ts',
          tests: [
            {
              name: 'should skip',
              classname: 'test/skip.spec.ts',
              time: 0,
              status: 'skipped' as const,
            },
          ],
        },
      ];
      const xml = generateJUnitXml(suites);
      expect(xml).toContain('<testsuite name="test/skip.spec.ts" tests="1" failures="0" skipped="1"');
      expect(xml).toContain('<skipped/>');
    });

    it('should escape XML characters in test names and messages', () => {
      const suites = [
        {
          name: 'test/special.spec.ts',
          tests: [
            {
              name: 'should handle <tags> & "quotes"',
              classname: 'test/special.spec.ts',
              time: 0.1,
              status: 'failed' as const,
              errorMessage: 'Error: <tag> & "value"',
              errorStack: '',
            },
          ],
        },
      ];
      const xml = generateJUnitXml(suites);
      expect(xml).toContain('testcase name="should handle &lt;tags&gt; &amp; &quot;quotes&quot;"');
      expect(xml).toContain('failure message="Error: &lt;tag&gt; &amp; &quot;value&quot;"');
    });

    it('should handle timedOut status as failure', () => {
      const suites = [
        {
          name: 'test/timeout.spec.ts',
          tests: [
            {
              name: 'should timeout',
              classname: 'test/timeout.spec.ts',
              time: 30.0,
              status: 'timedOut' as const,
              errorMessage: 'Test timeout of 30000ms exceeded',
              errorStack: '',
            },
          ],
        },
      ];
      const xml = generateJUnitXml(suites);
      expect(xml).toContain('tests="1" failures="1"');
      expect(xml).toContain('<failure message="Test timeout of 30000ms exceeded">');
    });

    it('should handle multiple test suites', () => {
      const suites = [
        {
          name: 'test/suite1.spec.ts',
          tests: [
            { name: 'test1', classname: 'test/suite1.spec.ts', time: 1.0, status: 'passed' as const },
          ],
        },
        {
          name: 'test/suite2.spec.ts',
          tests: [
            { name: 'test2', classname: 'test/suite2.spec.ts', time: 2.0, status: 'passed' as const },
          ],
        },
      ];
      const xml = generateJUnitXml(suites);
      expect(xml).toContain('<testsuite name="test/suite1.spec.ts"');
      expect(xml).toContain('<testsuite name="test/suite2.spec.ts"');
    });

    it('should default to "Test failed" for failed tests without error message', () => {
      const suites = [
        {
          name: 'test/default.spec.ts',
          tests: [
            {
              name: 'test',
              classname: 'test/default.spec.ts',
              time: 0.1,
              status: 'failed' as const,
              errorMessage: null,
            },
          ],
        },
      ];
      const xml = generateJUnitXml(suites);
      expect(xml).toContain('<failure message="Test failed">');
    });
  });
});
