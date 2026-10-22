import { describe, expect, it } from '@jest/globals';
import { hasPasswordSet } from '../../../src/services/auth/core/has-password.util';

describe('hasPasswordSet', () => {
  it('is true only for a non-blank hash', () => {
    expect(hasPasswordSet('$2b$12$abc')).toBe(true);
    expect(hasPasswordSet('')).toBe(false);
    expect(hasPasswordSet('   ')).toBe(false);
    expect(hasPasswordSet(null)).toBe(false);
    expect(hasPasswordSet(undefined)).toBe(false);
  });
});
