import { describe, expect, it } from '@jest/globals';
import {
  candidatesMatchingName,
  nameTokens,
  namesMatch,
} from '../../../src/services/auth/core/record-claim.util';

describe('nameTokens', () => {
  it('lower-cases and splits on spaces and punctuation', () => {
    expect(nameTokens('  Rahul  G. Barote ')).toEqual(['rahul', 'g', 'barote']);
    expect(nameTokens(null)).toEqual([]);
  });
});

describe('namesMatch', () => {
  it('matches the same name in any case', () => {
    expect(namesMatch('tanaji gaikwad', 'Tanaji Gaikwad')).toBe(true);
  });

  it('matches when one name has an extra middle word', () => {
    expect(namesMatch('Rahul Barote', 'Rahul Ganesh Barote')).toBe(true);
    expect(namesMatch('Rahul Ganesh Barote', 'Rahul Barote')).toBe(true);
  });

  it('matches regardless of word order', () => {
    expect(namesMatch('Gaikwad Tanaji', 'Tanaji Gaikwad')).toBe(true);
  });

  it('does not match on a single shared word when a name has two or more', () => {
    expect(namesMatch('Rahul', 'Rahul Barote')).toBe(false);
    expect(namesMatch('Rahul Patil', 'Rahul Barote')).toBe(false);
  });

  it('matches single-word names only with each other', () => {
    expect(namesMatch('Rahul', 'rahul')).toBe(true);
  });

  it('never matches empty names', () => {
    expect(namesMatch('', 'Rahul Barote')).toBe(false);
    expect(namesMatch('Rahul Barote', null)).toBe(false);
  });
});

describe('candidatesMatchingName', () => {
  const candidate = (patientId: string, name: string | null, first: string | null = null, last: string | null = null) => ({
    patientId,
    userId: `u-${patientId}`,
    name,
    firstName: first,
    lastName: last,
  });

  it('keeps only candidates whose stored name matches, using first and last name when there is no full name', () => {
    const result = candidatesMatchingName('Tanaji Gaikwad', [
      candidate('1', 'Tanaji Gaikwad'),
      candidate('2', 'Sunita Gaikwad'),
      candidate('3', null, 'Tanaji', 'Gaikwad'),
    ]);
    expect(result.map(entry => entry.patientId)).toEqual(['1', '3']);
  });
});
