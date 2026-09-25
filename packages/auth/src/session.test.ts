import { validateApiKey, validateServiceKey } from './session.js';

describe('validateApiKey', () => {
  it('returns true when provided key matches stored hash', () => {
    expect(validateApiKey('my-secret-key', 'my-secret-key')).toBe(true);
  });

  it('returns false when provided key does not match stored hash', () => {
    expect(validateApiKey('wrong-key', 'my-secret-key')).toBe(false);
  });

  it('returns false when provided key is empty', () => {
    expect(validateApiKey('', 'my-secret-key')).toBe(false);
  });

  it('returns false when stored hash is empty', () => {
    expect(validateApiKey('my-secret-key', '')).toBe(false);
  });

  it('returns true for identical empty strings', () => {
    expect(validateApiKey('', '')).toBe(true);
  });
});

describe('validateServiceKey', () => {
  it('returns true when provided key matches expected key', () => {
    expect(validateServiceKey('service-secret', 'service-secret')).toBe(true);
  });

  it('returns false when provided key does not match expected key', () => {
    expect(validateServiceKey('wrong-secret', 'service-secret')).toBe(false);
  });

  it('returns false for keys with different lengths', () => {
    expect(validateServiceKey('short', 'much-longer-secret')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(validateServiceKey('Secret', 'secret')).toBe(false);
  });
});
