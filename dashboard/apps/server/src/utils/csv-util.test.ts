import { describe, it, expect } from 'vitest';
import { toCsv, streamCsv } from './csv-util.js';

describe('csv-util', () => {
  describe('toCsv', () => {
    it('should convert array of objects to CSV string', () => {
      const rows = [
        { id: 1, name: 'Alice', age: 30 },
        { id: 2, name: 'Bob', age: 25 },
      ];
      const headers = ['id', 'name', 'age'];
      const csv = toCsv(rows, headers);
      expect(csv).toBe('id,name,age\n"1","Alice","30"\n"2","Bob","25"');
    });

    it('should handle null and undefined values', () => {
      const rows = [
        { id: 1, name: 'Alice', age: null },
        { id: 2, name: undefined, age: 25 },
      ];
      const headers = ['id', 'name', 'age'];
      const csv = toCsv(rows, headers);
      expect(csv).toBe('id,name,age\n"1","Alice",\n"2",,"25"');
    });

    it('should escape quotes in cell values', () => {
      const rows = [
        { id: 1, message: 'He said "Hello"' },
        { id: 2, message: 'She replied "Hi there"' },
      ];
      const headers = ['id', 'message'];
      const csv = toCsv(rows, headers);
      expect(csv).toBe('id,message\n"1","He said ""Hello"""\n"2","She replied ""Hi there"""');
    });

    it('should handle empty rows', () => {
      const rows: Array<Record<string, unknown>> = [];
      const headers = ['id', 'name'];
      const csv = toCsv(rows, headers);
      expect(csv).toBe('id,name');
    });

    it('should handle missing properties', () => {
      const rows = [
        { id: 1, name: 'Alice' },
        { id: 2 }, // missing 'name'
      ];
      const headers = ['id', 'name', 'age'];
      const csv = toCsv(rows, headers);
      expect(csv).toBe('id,name,age\n"1","Alice",\n"2",,');
    });
  });

  describe('streamCsv', () => {
    it('should stream CSV from iterable', async () => {
      const rows = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      const headers = ['id', 'name'];
      const chunks: string[] = [];
      for await (const chunk of streamCsv(rows, headers)) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([
        'id,name\n',
        '"1","Alice"\n',
        '"2","Bob"\n',
      ]);
    });

    it('should handle async iterables', async () => {
      async function* generate() {
        yield { id: 1, name: 'Alice' };
        yield { id: 2, name: 'Bob' };
      }
      const headers = ['id', 'name'];
      const chunks: string[] = [];
      for await (const chunk of streamCsv(generate(), headers)) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([
        'id,name\n',
        '"1","Alice"\n',
        '"2","Bob"\n',
      ]);
    });

    it('should escape quotes in streamed data', async () => {
      const rows = [{ message: 'Hello "world"' }];
      const headers = ['message'];
      const chunks: string[] = [];
      for await (const chunk of streamCsv(rows, headers)) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([
        'message\n',
        '"Hello ""world"""\n',
      ]);
    });
  });
});
