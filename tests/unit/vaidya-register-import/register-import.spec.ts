import { describe, it, expect } from '@jest/globals';
import { parseCsv } from '../../../src/scripts/vaidya-register-import/csv.util';
import {
  REGISTER_HEADERS,
  assertRegisterHeader,
  mapRegisterRow,
  normaliseIndianMobile,
} from '../../../src/scripts/vaidya-register-import/register-mapper';
import type { MappedRegisterRow } from '../../../src/scripts/vaidya-register-import/register-mapper';
import {
  assignOpdNumber,
  buildPlan,
  nameAndMobileKey,
  summarisePlan,
} from '../../../src/scripts/vaidya-register-import/import-plan';
import type { ExistingState } from '../../../src/scripts/vaidya-register-import/import-plan';
import { pgConnectionString } from '../../../src/scripts/vaidya-register-import/import-vaidya-register';

const TODAY = new Date('2026-10-10T00:00:00Z');

function cells(overrides: Record<number, string> = {}): string[] {
  const base = [
    '26/4116', '2026/609', '10/04/2026', 'sonali shendage', '9922055166', '30', 'Female', '-',
    '', 'paltan', 'Pune', 'Maharashtra', 'India', 'Friend/Relative', '', '', '', '',
  ];
  Object.entries(overrides).forEach(([index, value]) => {
    base[Number(index)] = value;
  });
  return base;
}

function mapped(overrides: Record<number, string> = {}, rowNumber = 2): MappedRegisterRow {
  const result = mapRegisterRow(cells(overrides), rowNumber, TODAY);
  if (!result.ok) throw new Error(result.reason);
  return result.row;
}

const EMPTY_EXISTING: ExistingState = {
  legacyToPatientId: new Map(),
  uniquePatientByNameAndMobile: new Map(),
  opdNumbers: new Set(),
};

describe('parseCsv', () => {
  it('reads plain rows with LF and CRLF line ends and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2\n3,4\n')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('handles quotes, doubled quotes, commas and line breaks inside quotes', () => {
    expect(parseCsv('"a,b","he said ""hi""","line1\nline2"\nx,y,z')).toEqual([
      ['a,b', 'he said "hi"', 'line1\nline2'],
      ['x', 'y', 'z'],
    ]);
  });

  it('keeps empty fields and skips blank lines', () => {
    expect(parseCsv('a,,c\n\n,,\nlast,1,2')).toEqual([['a', '', 'c'], ['', '', ''], ['last', '1', '2']]);
  });

  it('refuses a file that ends inside a quoted field', () => {
    expect(() => parseCsv('a,"unterminated')).toThrow(/quoted/);
  });
});

describe('assertRegisterHeader', () => {
  it('accepts the exact export layout and rejects anything else', () => {
    expect(() => assertRegisterHeader([...REGISTER_HEADERS])).not.toThrow();
    expect(() => assertRegisterHeader(['a', 'b'])).toThrow(/Unexpected CSV header/);
    const swapped: string[] = [...REGISTER_HEADERS];
    swapped[3] = 'Name';
    expect(() => assertRegisterHeader(swapped)).toThrow();
  });
});

describe('normaliseIndianMobile', () => {
  it.each([
    ['9922055166', '+919922055166'],
    ['+91 99220 55166', '+919922055166'],
    ['09922055166', '+919922055166'],
    ['919922055166', '+919922055166'],
    ['(99220) 55166', '+919922055166'],
    ['99220-55166', '+919922055166'],
  ])('accepts %s', (raw, expected) => {
    expect(normaliseIndianMobile(raw)).toBe(expected);
  });

  it.each(['12345', '1234567890', '99220551', '99220551667', 'abc', '', '5922055166'])(
    'rejects %s',
    raw => {
      expect(normaliseIndianMobile(raw)).toBeNull();
    }
  );
});

describe('mapRegisterRow', () => {
  it('maps a normal row', () => {
    const row = mapped();
    expect(row).toMatchObject({
      legacyRegistration: '26/4116',
      legacyOpd: '2026/609',
      caseDate: '2026-04-10',
      name: 'sonali shendage',
      firstName: 'sonali',
      lastName: 'shendage',
      gender: 'FEMALE',
      age: 30,
      dateOfBirth: null,
      mobile: '+919922055166',
      email: null,
      city: 'Pune',
      country: 'India',
      issues: [],
    });
  });

  it('refuses rows that cannot be a record at all', () => {
    expect(mapRegisterRow(cells({ 0: '' }), 5, TODAY)).toMatchObject({ ok: false, rowNumber: 5 });
    expect(mapRegisterRow(cells({ 3: '   ' }), 5, TODAY)).toMatchObject({ ok: false });
    expect(mapRegisterRow(cells({ 2: '31/02/2026' }), 5, TODAY)).toMatchObject({ ok: false });
    expect(mapRegisterRow(cells({ 2: 'yesterday' }), 5, TODAY)).toMatchObject({ ok: false });
    expect(mapRegisterRow(cells({ 2: '10/04/2031' }), 5, TODAY)).toMatchObject({ ok: false });
    expect(mapRegisterRow(cells({ 2: '10/04/1980' }), 5, TODAY)).toMatchObject({ ok: false });
  });

  it('keeps the row but drops and counts an implausible age', () => {
    const row = mapped({ 5: '5200' });
    expect(row.age).toBeNull();
    expect(row.issues).toContain('AGE_OUT_OF_RANGE');
    expect(mapped({ 5: '0' }).age).toBe(0);
    expect(mapped({ 5: '' }).age).toBeNull();
  });

  it('drops and counts an unusable mobile, email and unknown gender', () => {
    const row = mapped({ 4: '12345', 8: 'not-an-email', 6: 'Other' });
    expect(row.mobile).toBeNull();
    expect(row.email).toBeNull();
    expect(row.gender).toBeNull();
    expect(row.issues).toEqual(expect.arrayContaining(['MOBILE_UNUSABLE', 'EMAIL_INVALID', 'GENDER_UNKNOWN']));
  });

  it('normalises the country and lower-cases a valid email', () => {
    const row = mapped({ 12: 'India (+91)', 8: ' Kiran@Example.COM ' });
    expect(row.country).toBe('India');
    expect(row.issues).toContain('COUNTRY_NORMALISED');
    expect(row.email).toBe('kiran@example.com');
  });

  it('accepts a real date of birth and refuses a future one', () => {
    expect(mapped({ 7: '05/06/1990' }).dateOfBirth).toBe('1990-06-05');
    const future = mapped({ 7: '05/06/2030' });
    expect(future.dateOfBirth).toBeNull();
    expect(future.issues).toContain('DOB_INVALID');
  });

  it('merges the two modern-diagnosis columns only when the second adds something', () => {
    expect(mapped({ 16: 'Abdominal Pain', 17: 'abdominal pain' }).modernDiagnosis).toBe('Abdominal Pain');
    expect(mapped({ 16: 'Eczema', 17: 'skin rash' }).modernDiagnosis).toBe('Eczema; skin rash');
    expect(mapped({ 17: 'only here' }).modernDiagnosis).toBe('only here');
    expect(mapped({ 15: 'PARINAMSHUL' }).ayurvedicDiagnosis).toBe('PARINAMSHUL');
  });

  it('collapses whitespace and strips control characters from names', () => {
    expect(mapped({ 3: '  anil \t  bodhe\u0000 ' }).name).toBe('anil bodhe');
  });

  it('flags a missing visit number', () => {
    expect(mapped({ 1: '' }).issues).toContain('OPD_MISSING');
  });
});

describe('assignOpdNumber', () => {
  it('uses the register visit number and suffixes collisions deterministically', () => {
    const taken = new Set<string>();
    expect(assignOpdNumber({ legacyOpd: '2018/609', legacyRegistration: 'A' }, taken)).toBe('VM-2018/609');
    expect(assignOpdNumber({ legacyOpd: '2018/609', legacyRegistration: 'B' }, taken)).toBe('VM-2018/609~B');
    expect(assignOpdNumber({ legacyOpd: '2018/609', legacyRegistration: 'B' }, taken)).toBe('VM-2018/609~B~2');
    expect(assignOpdNumber({ legacyOpd: null, legacyRegistration: 'C' }, taken)).toBe('VM-C');
  });
});

describe('buildPlan', () => {
  const rows = [
    mapped({ 0: 'R1', 1: '2018/1', 2: '01/02/2018', 3: 'asha kulkarni', 4: '', 9: '' }, 2),
    mapped({ 0: 'R1', 1: '2019/9', 2: '05/06/2019', 3: 'asha kulkarni', 4: '9922055166', 9: 'pune' }, 3),
    mapped({ 0: 'R2', 1: '2018/1', 2: '03/02/2018', 3: 'ravi patil', 4: '9922055166' }, 4),
    mapped({ 0: 'R3', 1: '2020/4', 2: '04/04/2020', 3: 'meera joshi', 4: '' }, 5),
  ];

  it('groups rows by register number, one patient with all their visits', () => {
    const plan = buildPlan(rows, EMPTY_EXISTING);
    expect(plan.patients.map(p => p.legacyRegistration)).toEqual(['R1', 'R2', 'R3']);
    expect(plan.patients[0]?.visits).toHaveLength(2);
    expect(plan.patients[0]?.firstCaseDate).toBe('2018-02-01');
  });

  it('takes each demographic from the newest row that has it', () => {
    const profile = buildPlan(rows, EMPTY_EXISTING).patients[0]?.profile;
    expect(profile?.mobile).toBe('+919922055166');
    expect(profile?.address).toBe('pune');
  });

  it('numbers visits the same way every run and resolves collisions', () => {
    const first = buildPlan(rows, EMPTY_EXISTING).patients.flatMap(p => p.visits.map(v => v.opdNumber));
    const second = buildPlan(rows, EMPTY_EXISTING).patients.flatMap(p => p.visits.map(v => v.opdNumber));
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toContain('VM-2018/1');
    expect(first).toContain('VM-2018/1~R2');
  });

  it('recognises patients and visits from an earlier run and only plans what is missing', () => {
    const existing: ExistingState = {
      legacyToPatientId: new Map([['R1', 'patient-1']]),
      uniquePatientByNameAndMobile: new Map(),
      opdNumbers: new Set(['VM-2018/1']),
    };
    const plan = buildPlan(rows, existing);
    const r1 = plan.patients.find(p => p.legacyRegistration === 'R1');
    expect(r1).toMatchObject({ mode: 'ALREADY_IMPORTED', existingPatientId: 'patient-1' });
    expect(r1?.visits.map(v => v.opdNumber)).toEqual(['VM-2019/9']);
    expect(r1?.visitsAlreadyPresent).toBe(1);
  });

  it('links to an existing patient only on an exact name and mobile match', () => {
    const existing: ExistingState = {
      ...EMPTY_EXISTING,
      uniquePatientByNameAndMobile: new Map([[nameAndMobileKey('Ravi  Patil', '+919922055166'), 'patient-9']]),
    };
    const plan = buildPlan(rows, existing);
    expect(plan.patients.find(p => p.legacyRegistration === 'R2')).toMatchObject({
      mode: 'LINK_EXISTING',
      existingPatientId: 'patient-9',
    });
    expect(plan.patients.find(p => p.legacyRegistration === 'R3')?.mode).toBe('NEW');
  });

  it('limits to the first N patients in file order', () => {
    expect(buildPlan(rows, EMPTY_EXISTING, { limitPatients: 2 }).patients.map(p => p.legacyRegistration)).toEqual([
      'R1',
      'R2',
    ]);
  });

  it('summarises the plan and counts shared mobiles', () => {
    const summary = summarisePlan(buildPlan(rows, EMPTY_EXISTING));
    expect(summary).toMatchObject({
      patientsNew: 3,
      patientsLinkedToExisting: 0,
      patientsAlreadyImported: 0,
      visitsToCreate: 4,
      newPatientsWithMobile: 2,
      mobilesSharedByNewPatients: 1,
    });
  });
});

describe('pgConnectionString', () => {
  it('drops Prisma-only parameters the pg driver does not understand', () => {
    const url = pgConnectionString('postgresql://u:p@db:5432/userdb?connection_limit=50&pool_timeout=20&sslmode=disable');
    expect(url).not.toContain('connection_limit');
    expect(url).not.toContain('pool_timeout');
    expect(url).toContain('sslmode=disable');
  });
});
