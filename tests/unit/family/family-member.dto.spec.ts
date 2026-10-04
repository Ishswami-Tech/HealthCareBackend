/**
 * Unit tests for family member DTO validation (gender allowlist, notes length,
 * plausible date of birth).
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateFamilyMemberDto,
  CreateMyFamilyMemberDto,
  UpdateFamilyMemberDto,
  isPlausibleBirthDate,
} from '@dtos/family-member.dto';

const BASE = { firstName: 'Aarav', lastName: 'Bhujbal', relation: 'Son' };

function errorsFor<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
  options: { strict?: boolean } = {}
): string[] {
  const instance = plainToInstance(cls, plain);
  return validateSync(
    instance,
    options.strict ? { whitelist: true, forbidNonWhitelisted: true } : {}
  ).map(error => error.property);
}

function dayOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe('isPlausibleBirthDate', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');

  it('accepts dates from 1900-01-01 up to today', () => {
    expect(isPlausibleBirthDate('1900-01-01', now)).toBe(true);
    expect(isPlausibleBirthDate('2018-04-12', now)).toBe(true);
    expect(isPlausibleBirthDate('2026-10-03', now)).toBe(true);
  });

  it('rejects dates before 1900, in the future, or malformed', () => {
    expect(isPlausibleBirthDate('1899-12-31', now)).toBe(false);
    expect(isPlausibleBirthDate('2026-10-10', now)).toBe(false);
    expect(isPlausibleBirthDate('2999-01-01', now)).toBe(false);
    expect(isPlausibleBirthDate('nonsense', now)).toBe(false);
    expect(isPlausibleBirthDate(undefined, now)).toBe(false);
  });
});

describe('CreateMyFamilyMemberDto / CreateFamilyMemberDto', () => {
  it('accepts exactly what the mobile family sheet sends', () => {
    const payload = {
      ...BASE,
      gender: 'MALE',
      dateOfBirth: '2018-04-12',
      phone: '+919876543210',
    };
    expect(errorsFor(CreateMyFamilyMemberDto, payload)).toEqual([]);
    expect(errorsFor(CreateFamilyMemberDto, { ...payload, primaryPatientId: 'p-1' })).toEqual([]);
  });

  it.each(['MALE', 'FEMALE', 'OTHER'])('accepts gender %s', gender => {
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, gender })).toEqual([]);
  });

  it('normalises gender case and whitespace', () => {
    const instance = plainToInstance(CreateMyFamilyMemberDto, { ...BASE, gender: ' female ' });
    expect(instance.gender).toBe('FEMALE');
    expect(validateSync(instance)).toEqual([]);
  });

  it('rejects gender values outside MALE / FEMALE / OTHER', () => {
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, gender: 'robot' })).toEqual(['gender']);
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, gender: 'M' })).toEqual(['gender']);
  });

  it('allows an omitted gender', () => {
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE })).toEqual([]);
  });

  it('limits notes to 500 characters', () => {
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, notes: 'n'.repeat(500) })).toEqual([]);
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, notes: 'n'.repeat(501) })).toEqual([
      'notes',
    ]);
  });

  it('rejects a date of birth in the future or before 1900', () => {
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, dateOfBirth: dayOffset(30) })).toEqual([
      'dateOfBirth',
    ]);
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, dateOfBirth: '1899-12-31' })).toEqual([
      'dateOfBirth',
    ]);
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, dateOfBirth: 'not-a-date' })).toContain(
      'dateOfBirth'
    );
  });

  it('accepts today and 1900-01-01 as a date of birth', () => {
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, dateOfBirth: dayOffset(0) })).toEqual([]);
    expect(errorsFor(CreateMyFamilyMemberDto, { ...BASE, dateOfBirth: '1900-01-01' })).toEqual([]);
  });

  it('keeps the self-service DTO free of primaryPatientId (whitelist rejects it)', () => {
    expect(
      errorsFor(
        CreateMyFamilyMemberDto,
        { ...BASE, primaryPatientId: 'someone-else' },
        { strict: true }
      )
    ).toEqual(['primaryPatientId']);
  });
});

describe('UpdateFamilyMemberDto', () => {
  it('lets the mobile edit sheet clear gender with an empty string', () => {
    expect(errorsFor(UpdateFamilyMemberDto, { gender: '' })).toEqual([]);
    expect(errorsFor(UpdateFamilyMemberDto, { phone: '' })).toEqual([]);
  });

  it('applies the same gender, notes and date of birth rules', () => {
    expect(errorsFor(UpdateFamilyMemberDto, { gender: 'robot' })).toEqual(['gender']);
    expect(errorsFor(UpdateFamilyMemberDto, { notes: 'n'.repeat(501) })).toEqual(['notes']);
    expect(errorsFor(UpdateFamilyMemberDto, { dateOfBirth: '2999-01-01' })).toEqual([
      'dateOfBirth',
    ]);
    expect(
      errorsFor(UpdateFamilyMemberDto, { gender: 'other', dateOfBirth: '2010-05-05' })
    ).toEqual([]);
  });
});
