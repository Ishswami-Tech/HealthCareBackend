import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache/cache.service';
import type {
  PatientDirectoryFacets,
  PatientDirectoryFacetValue,
  PatientDirectoryFilters,
  PatientDirectoryPage,
  PatientDirectoryQuery,
  PatientDirectoryRow,
} from '@core/types/patient-directory.types';
import { PATIENT_DIRECTORY_DEFAULT_PAGE_SIZE } from '@core/types/patient-directory.types';
import { PhiAuditService } from '@services/compliance/services/phi-audit.service';
import { complianceErrors } from '@services/compliance/utils/compliance-errors.util';
import type { PatientDirectoryQueryDto } from './dto/patient-directory-query.dto';
import { classifySearchTerm } from './utils/directory-search.util';
import {
  FACET_SQL,
  buildDirectoryCountSql,
  buildDirectoryPageSql,
} from './utils/directory-sql.util';

interface RawQueryClient {
  $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => Promise<T>;
}

interface DirectoryDbRow {
  patient_id: string;
  user_id: string;
  registered_at: Date | string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  gender: string | null;
  age: number | null;
  dateOfBirth: Date | string | null;
  city: string | null;
  state: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  uhid: string | null;
  legacy_registration: string | null;
  visits: number | string | bigint;
  first_visit: Date | string | null;
  last_visit: Date | string | null;
  reference_source: string | null;
  total_count: number | string | bigint;
}

export interface DirectoryActor {
  readonly userId: string;
  readonly role: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

const AUDIT_PURPOSE = 'patient directory search';

/**
 * The filter values hold counts per city/state/source/year, no personal data, and change slowly:
 * cached for a few minutes. The patient rows themselves are deliberately NOT cached on the server, so
 * a patient registered a moment ago is found at once and personal data is not copied into the cache.
 */
const FACETS_TTL_SECONDS = 300;
const facetsCacheKey = (clinicId: string): string => `patient-directory:${clinicId}:facets`;

const toIso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

/**
 * The searchable, filterable, paged patient list for staff.
 *
 * Replaces list endpoints that loaded the whole clinic into memory: filtering, sorting and paging
 * all run in the database, and only named columns are read (never the whole `users` row).
 */
@Injectable()
export class PatientDirectoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly phiAudit: PhiAuditService,
    private readonly cache: CacheService
  ) {}

  async search(
    clinicId: string,
    dto: PatientDirectoryQueryDto,
    actor: DirectoryActor
  ): Promise<PatientDirectoryPage> {
    const query = this.toQuery(clinicId, dto);
    const { sql, params } = buildDirectoryPageSql(query);

    const rows = await this.database.executeHealthcareRead<DirectoryDbRow[]>(async client => {
      return (client as unknown as RawQueryClient).$queryRawUnsafe<DirectoryDbRow[]>(
        sql,
        ...params
      );
    });

    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : await this.count(query);
    await this.audit(clinicId, query.filters, rows.length, actor);

    return {
      rows: rows.map(row => this.toRow(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async facets(clinicId: string): Promise<PatientDirectoryFacets> {
    return this.cache.cache(facetsCacheKey(clinicId), () => this.loadFacets(clinicId), {
      ttl: FACETS_TTL_SECONDS,
      tags: ['patient-directory', `clinic:${clinicId}`],
      enableSwr: true,
    });
  }

  private async loadFacets(clinicId: string): Promise<PatientDirectoryFacets> {
    const run = (sql: string): Promise<PatientDirectoryFacetValue[]> =>
      this.database.executeHealthcareRead<PatientDirectoryFacetValue[]>(async client => {
        const raw = await (client as unknown as RawQueryClient).$queryRawUnsafe<
          Array<{ value: string; count: number | bigint }>
        >(sql, clinicId);
        return raw.map(entry => ({ value: entry.value, count: Number(entry.count) }));
      });
    const [cities, states, referenceSources, caseYears] = await Promise.all([
      run(FACET_SQL.cities),
      run(FACET_SQL.states),
      run(FACET_SQL.referenceSources),
      run(FACET_SQL.caseYears),
    ]);
    return { cities, states, referenceSources, caseYears };
  }

  private toQuery(clinicId: string, dto: PatientDirectoryQueryDto): PatientDirectoryQuery {
    if (dto.ageMin !== undefined && dto.ageMax !== undefined && dto.ageMin > dto.ageMax) {
      throw complianceErrors.invalid('ageMin cannot be greater than ageMax');
    }
    if (dto.caseDateFrom && dto.caseDateTo && dto.caseDateFrom > dto.caseDateTo) {
      throw complianceErrors.invalid('caseDateFrom cannot be after caseDateTo');
    }
    const search = classifySearchTerm(dto.search);
    if (dto.search && dto.search.trim().length > 0 && search === null) {
      throw complianceErrors.invalid('Type at least 2 characters to search');
    }
    const filters: PatientDirectoryFilters = {
      ...(search ? { search } : {}),
      ...(dto.gender ? { gender: dto.gender } : {}),
      ...(dto.ageMin !== undefined ? { ageMin: dto.ageMin } : {}),
      ...(dto.ageMax !== undefined ? { ageMax: dto.ageMax } : {}),
      ...(dto.city ? { city: dto.city } : {}),
      ...(dto.state ? { state: dto.state } : {}),
      ...(dto.referenceSource ? { referenceSource: dto.referenceSource } : {}),
      ...(dto.caseDateFrom ? { caseDateFrom: dto.caseDateFrom } : {}),
      ...(dto.caseDateTo ? { caseDateTo: dto.caseDateTo } : {}),
      ...(dto.hasMobile !== undefined ? { hasMobile: dto.hasMobile } : {}),
      ...(dto.hasDiagnosis !== undefined ? { hasDiagnosis: dto.hasDiagnosis } : {}),
      ...(dto.minVisits !== undefined ? { minVisits: dto.minVisits } : {}),
    };
    return {
      clinicId,
      filters,
      sort: dto.sort ?? 'registered',
      order: dto.order ?? 'desc',
      page: dto.page ?? 1,
      pageSize: dto.pageSize ?? PATIENT_DIRECTORY_DEFAULT_PAGE_SIZE,
    };
  }

  private async count(query: PatientDirectoryQuery): Promise<number> {
    const { sql, params } = buildDirectoryCountSql(query);
    const result = await this.database.executeHealthcareRead<Array<{ total: number | bigint }>>(
      async client =>
        (client as unknown as RawQueryClient).$queryRawUnsafe<Array<{ total: number | bigint }>>(
          sql,
          ...params
        )
    );
    return Number(result[0]?.total ?? 0);
  }

  private toRow(row: DirectoryDbRow): PatientDirectoryRow {
    const fallbackName = [row.firstName, row.lastName].filter(Boolean).join(' ');
    return {
      patientId: row.patient_id,
      userId: row.user_id,
      name: row.name ?? (fallbackName || 'Unnamed patient'),
      gender: row.gender,
      age: row.age,
      dateOfBirth: toIso(row.dateOfBirth),
      city: row.city,
      state: row.state,
      phone: row.contact_phone,
      email: row.contact_email,
      uhid: row.uhid,
      legacyRegistration: row.legacy_registration,
      totalVisits: Number(row.visits),
      firstVisit: toIso(row.first_visit),
      lastVisit: toIso(row.last_visit),
      referenceSource: row.reference_source,
      registeredAt: new Date(row.registered_at).toISOString(),
    };
  }

  /** One row per search: which filters were used and how many patients came back, never the values. */
  private async audit(
    clinicId: string,
    filters: PatientDirectoryFilters,
    returned: number,
    actor: DirectoryActor
  ): Promise<void> {
    const used = Object.entries(filters)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    await this.phiAudit.record({
      userId: actor.userId,
      userRole: actor.role,
      patientId: '*',
      clinicId,
      action: 'VIEW',
      resourceType: 'PATIENT_DIRECTORY',
      resourceId: clinicId,
      purpose: AUDIT_PURPOSE,
      fields: used.length > 0 ? used : ['unfiltered'],
      reason: `${returned} patients returned`,
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    });
  }
}
