import { describe, expect, it } from '@jest/globals';
import {
  candidatesMatchingName,
  isForeignKeyOrUniqueViolation,
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

  it('does not let a father claim his son: the first word must agree', () => {
    expect(namesMatch('Ganesh Barote', 'Rahul Ganesh Barote')).toBe(false);
    expect(namesMatch('Rahul Ganesh Barote', 'Ganesh Barote')).toBe(false);
  });

  it('needs the first word to be the same, so a reversed order does not match', () => {
    expect(namesMatch('Gaikwad Tanaji', 'Tanaji Gaikwad')).toBe(false);
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

describe('isForeignKeyOrUniqueViolation', () => {
  it('recognises Postgres foreign-key and unique violations however they are wrapped', () => {
    expect(isForeignKeyOrUniqueViolation({ code: '23503' })).toBe(true);
    expect(isForeignKeyOrUniqueViolation({ code: 'P2010', meta: { code: '23505' } })).toBe(true);
    expect(isForeignKeyOrUniqueViolation({ cause: { code: '23503' } })).toBe(true);
    expect(isForeignKeyOrUniqueViolation(new Error('update violates foreign key constraint "x"'))).toBe(true);
    expect(isForeignKeyOrUniqueViolation(new Error('Unique constraint failed on the fields: (phone)'))).toBe(true);
  });

  it('does not treat other errors as a merge conflict', () => {
    expect(isForeignKeyOrUniqueViolation(new Error('connection reset'))).toBe(false);
    expect(isForeignKeyOrUniqueViolation({ code: '57014' })).toBe(false);
    expect(isForeignKeyOrUniqueViolation(null)).toBe(false);
  });
});
