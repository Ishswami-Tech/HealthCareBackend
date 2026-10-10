import { describe, expect, it } from '@jest/globals';
import type {
  PatientDirectoryFilters,
  PatientDirectoryQuery,
} from '../../../src/libs/core/types/patient-directory.types';
import { classifySearchTerm } from '../../../src/services/patient-directory/utils/directory-search.util';
import {
  buildDirectoryCountSql,
  buildDirectoryPageSql,
} from '../../../src/services/patient-directory/utils/directory-sql.util';

/** A filter set holding the recognised form of what was typed (the search term is always valid here). */
const searching = (text: string): PatientDirectoryFilters => {
  const search = classifySearchTerm(text);
  if (!search) throw new Error(`"${text}" is not a searchable term`);
  return { search };
};

const base: PatientDirectoryQuery = {
  clinicId: 'clinic-1',
  filters: {},
  sort: 'registered',
  order: 'desc',
  page: 1,
  pageSize: 50,
};

describe('buildDirectoryPageSql', () => {
  it('binds the clinic, limit and offset as parameters', () => {
    const { sql, params } = buildDirectoryPageSql({ ...base, page: 3, pageSize: 200 });
    expect(params).toEqual(['clinic-1', 200, 400]);
    expect(sql).toContain('LIMIT $2 OFFSET $3');
  });

  it('never puts typed text into the SQL string', () => {
    const hostile = "x'; DROP TABLE users; --";
    const { sql, params } = buildDirectoryPageSql({
      ...base,
      filters: { ...searching(hostile), city: hostile, referenceSource: hostile },
    });
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain(hostile);
    expect(params.some(value => typeof value === 'string' && value.includes('DROP TABLE'))).toBe(true);
  });

  it('selects named columns only, never every user column', () => {
    const { sql } = buildDirectoryPageSql(base);
    expect(sql).not.toMatch(/u\.\*|users\.\*|SELECT \*/i);
    expect(sql.toLowerCase()).not.toContain('password');
  });

  it('matches every name word against the three name columns', () => {
    const { sql, params } = buildDirectoryPageSql({ ...base, filters: searching('tanaji gaikwad') });
    expect(params).toEqual(['clinic-1', '%tanaji%', '%gaikwad%', 50, 0]);
    expect(sql.match(/lower\(u\.name\) LIKE/g)).toHaveLength(2);
  });

  it('looks a UHID up as an exact identifier', () => {
    const { sql, params } = buildDirectoryPageSql({ ...base, filters: searching('CL0002-000000208') });
    expect(sql).toContain("i.system = 'UHID'");
    expect(params).toContain('CL0002-000000208');
  });

  it('searches phones in both the login phone and contact points', () => {
    const { sql, params } = buildDirectoryPageSql({ ...base, filters: searching('98765') });
    expect(sql).toContain('patient_contact_points');
    expect(params).toContain('%98765%');
  });

  it('applies demographic, date and visit filters', () => {
    const { sql, params } = buildDirectoryPageSql({
      ...base,
      filters: {
        gender: 'FEMALE',
        ageMin: 20,
        ageMax: 40,
        city: 'Pune',
        referenceSource: 'Doctor',
        caseDateFrom: '2024-01-01',
        caseDateTo: '2024-12-31',
        minVisits: 2,
        hasMobile: true,
        hasDiagnosis: false,
      },
    });
    expect(params).toEqual([
      'clinic-1',
      'FEMALE',
      20,
      40,
      'Pune',
      'Doctor',
      '2024-01-01',
      '2024-12-31',
      2,
      50,
      0,
    ]);
    expect(sql).toContain('NOT (');
  });

  it('orders by a whitelisted expression with a stable tiebreak', () => {
    const { sql } = buildDirectoryPageSql({ ...base, sort: 'lastVisit', order: 'asc' });
    expect(sql).toContain('m.last_visit ASC NULLS LAST, m.patient_id ASC');
  });
});

describe('buildDirectoryCountSql', () => {
  it('uses the same filters without paging parameters', () => {
    const { params } = buildDirectoryCountSql({ ...base, filters: { gender: 'MALE' } });
    expect(params).toEqual(['clinic-1', 'MALE']);
  });
});
