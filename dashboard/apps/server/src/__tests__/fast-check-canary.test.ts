import fc from 'fast-check';

test('canary: integer is a number', () => {
  fc.assert(
    fc.property(fc.integer(), (n) => {
      expect(typeof n).toBe('number');
    }),
  );
});
