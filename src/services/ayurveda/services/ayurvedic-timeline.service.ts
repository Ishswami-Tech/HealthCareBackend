/**
 * Ayurvedic Clinical Timeline Service
 * @module Ayurvedic Timeline
 * @description Aggregates longitudinal Ayurvedic health data for patients
 */

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { HealthcareError, ErrorCode } from '@core/errors';
import { computeDoshaTrend } from '@services/ayurveda/utils/dosha-trend.util';
import { DoshaType } from '@services/ayurveda/dto';

const TIMELINE_CACHE_PREFIX = 'ayurveda:timeline';
const TIMELINE_CACHE_TTL = 300;

type DateRangeFilter = {
  gte?: Date;
  lte?: Date;
};

type PrakritiRecord = {
  assessedAt: Date;
  vataScore: number | null;
  pittaScore: number | null;
  kaphaScore: number | null;
};

type NadiRecord = {
  assessedAt: Date;
};

type DoshaImbalanceRecord = {
  assessedAt: Date;
  doshaType: string;
  severity: string;
};

type DiagnosisRecord = {
  diagnosedAt: Date;
};

type SampraptiStageRecord = {
  createdAt: Date;
};

type TimelineEvent = {
  type: string;
  date: string;
  assessedAt?: string | undefined;
  diagnosedAt?: string | undefined;
  createdAt?: string | undefined;
  category?: string | undefined;
  doshaType?: string | undefined;
  severity?: string | undefined;
  vataScore?: number | undefined;
  pittaScore?: number | undefined;
  kaphaScore?: number | undefined;
};

@Injectable()
export class AyurvedicTimelineService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService
  ) {}

  async getPatientTimeline(
    patientId: string,
    clinicId: string,
    fromDate?: string,
    toDate?: string
  ): Promise<{
    events: TimelineEvent[];
    doshaTrend: Record<string, unknown>;
    summary: Record<string, unknown>;
  }> {
    this.logger.info('Generating Ayurvedic timeline', {
      module: 'AyurvedicTimeline',
      patientId,
      clinicId,
      fromDate,
      toDate,
    });

    const cacheKey = `${TIMELINE_CACHE_PREFIX}:${clinicId}:${patientId}:${fromDate ?? 'all'}:${toDate ?? 'all'}`;
    const cached = await this.cache.get<{
      events: TimelineEvent[];
      doshaTrend: Record<string, unknown>;
      summary: Record<string, unknown>;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const dateFilter = this.buildDateFilter(fromDate, toDate);

    const [prakritiAssessments, nadiRecords, imbalances, diagnoses, sampraptiStages] =
      await Promise.all([
        this.getPrakritiHistory(patientId, clinicId, dateFilter),
        this.getNadiHistory(patientId, clinicId, dateFilter),
        this.getImbalanceHistory(patientId, clinicId, dateFilter),
        this.getDiagnoses(patientId, clinicId, dateFilter),
        this.getSampraptiStages(patientId, clinicId, dateFilter),
      ]);

    const events = this.mergeAndSortEvents([
      ...prakritiAssessments.map(assessment => ({
        type: 'prakriti',
        date: assessment.assessedAt.toISOString(),
        assessedAt: assessment.assessedAt.toISOString(),
        vataScore: assessment.vataScore ?? undefined,
        pittaScore: assessment.pittaScore ?? undefined,
        kaphaScore: assessment.kaphaScore ?? undefined,
      })),
      ...nadiRecords.map(record => ({
        type: 'nadi_pariksha',
        date: record.assessedAt.toISOString(),
        assessedAt: record.assessedAt.toISOString(),
      })),
      ...imbalances.map(record => ({
        type: 'dosha_imbalance',
        date: record.assessedAt.toISOString(),
        assessedAt: record.assessedAt.toISOString(),
        doshaType: record.doshaType,
        severity: record.severity,
      })),
      ...diagnoses.map(record => ({
        type: 'diagnosis',
        date: record.diagnosedAt.toISOString(),
        diagnosedAt: record.diagnosedAt.toISOString(),
      })),
      ...sampraptiStages.map(record => ({
        type: 'samprapti',
        date: record.createdAt.toISOString(),
        createdAt: record.createdAt.toISOString(),
      })),
    ]);

    const doshaTrend = computeDoshaTrend(events);
    const summary = this.computeSummary(events);
    const result = { events, doshaTrend, summary };

    await this.cache.set(cacheKey, result, TIMELINE_CACHE_TTL);

    this.logger.info('Ayurvedic timeline generated', {
      module: 'AyurvedicTimeline',
      patientId,
      eventCount: events.length,
    });

    return result;
  }

  async invalidateCache(patientId: string, clinicId: string): Promise<void> {
    const pattern = `${TIMELINE_CACHE_PREFIX}:${clinicId}:${patientId}:*`;
    await this.cache.invalidatePattern(pattern);
  }

  private async getPrakritiHistory(
    patientId: string,
    clinicId: string,
    dateFilter: DateRangeFilter
  ): Promise<PrakritiRecord[]> {
    const where: {
      patientId: string;
      clinicId: string;
      assessedAt?: DateRangeFilter;
    } = { patientId, clinicId };

    if (dateFilter.gte || dateFilter.lte) {
      where.assessedAt = {};
      if (dateFilter.gte) where.assessedAt.gte = dateFilter.gte;
      if (dateFilter.lte) where.assessedAt.lte = dateFilter.lte;
    }

    return this.db.prisma.prakritiAssessment.findMany({
      where,
      orderBy: { assessedAt: 'desc' },
    }) as Promise<PrakritiRecord[]>;
  }

  private async getNadiHistory(
    patientId: string,
    clinicId: string,
    dateFilter: DateRangeFilter
  ): Promise<NadiRecord[]> {
    const where: {
      patientId: string;
      clinicId: string;
      assessedAt?: DateRangeFilter;
    } = { patientId, clinicId };

    if (dateFilter.gte || dateFilter.lte) {
      where.assessedAt = {};
      if (dateFilter.gte) where.assessedAt.gte = dateFilter.gte;
      if (dateFilter.lte) where.assessedAt.lte = dateFilter.lte;
    }

    return this.db.prisma.nadiPariksha.findMany({
      where,
      orderBy: { assessedAt: 'desc' },
    }) as Promise<NadiRecord[]>;
  }

  private async getImbalanceHistory(
    patientId: string,
    clinicId: string,
    dateFilter: DateRangeFilter
  ): Promise<DoshaImbalanceRecord[]> {
    const where: {
      patientId: string;
      clinicId: string;
      assessedAt?: DateRangeFilter;
    } = { patientId, clinicId };

    if (dateFilter.gte || dateFilter.lte) {
      where.assessedAt = {};
      if (dateFilter.gte) where.assessedAt.gte = dateFilter.gte;
      if (dateFilter.lte) where.assessedAt.lte = dateFilter.lte;
    }

    return this.db.prisma.doshaImbalance.findMany({
      where,
      orderBy: { assessedAt: 'desc' },
    }) as Promise<DoshaImbalanceRecord[]>;
  }

  private async getDiagnoses(
    patientId: string,
    clinicId: string,
    dateFilter: DateRangeFilter
  ): Promise<DiagnosisRecord[]> {
    const where: {
      patientId: string;
      clinicId: string;
      diagnosedAt?: DateRangeFilter;
    } = { patientId, clinicId };

    if (dateFilter.gte || dateFilter.lte) {
      where.diagnosedAt = {};
      if (dateFilter.gte) where.diagnosedAt.gte = dateFilter.gte;
      if (dateFilter.lte) where.diagnosedAt.lte = dateFilter.lte;
    }

    return this.db.prisma.ayurvedicDiagnosis.findMany({
      where,
      orderBy: { diagnosedAt: 'desc' },
    }) as Promise<DiagnosisRecord[]>;
  }

  private async getSampraptiStages(
    patientId: string,
    clinicId: string,
    dateFilter: DateRangeFilter
  ): Promise<SampraptiStageRecord[]> {
    const diagnoses = await this.db.prisma.ayurvedicDiagnosis.findMany({
      where: { patientId, clinicId },
      select: { id: true },
    });

    const diagnosisIds = diagnoses.map((diagnosis: { id: string }) => diagnosis.id);
    if (diagnosisIds.length === 0) {
      return [];
    }

    const where: {
      diagnosisId: { in: string[] };
      createdAt?: DateRangeFilter;
    } = { diagnosisId: { in: diagnosisIds } };

    if (dateFilter.gte || dateFilter.lte) {
      where.createdAt = {};
      if (dateFilter.gte) where.createdAt.gte = dateFilter.gte;
      if (dateFilter.lte) where.createdAt.lte = dateFilter.lte;
    }

    return this.db.prisma.sampraptiStage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    }) as Promise<SampraptiStageRecord[]>;
  }

  private buildDateFilter(fromDate?: string, toDate?: string): DateRangeFilter {
    const filter: DateRangeFilter = {};

    if (fromDate) {
      filter.gte = new Date(fromDate);
    }

    if (toDate) {
      filter.lte = new Date(toDate);
    }

    return filter;
  }

  private mergeAndSortEvents(events: TimelineEvent[]): TimelineEvent[] {
    return [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private computeSummary(events: TimelineEvent[]): Record<string, unknown> {
    const counts: Record<string, number> = {};
    let firstEventDate: string | null = null;
    let lastEventDate: string | null = null;

    for (const event of events) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;

      if (!firstEventDate || event.date < firstEventDate) {
        firstEventDate = event.date;
      }
      if (!lastEventDate || event.date > lastEventDate) {
        lastEventDate = event.date;
      }
    }

    return {
      totalEvents: events.length,
      categoryCounts: counts,
      dateRange: {
        from: firstEventDate,
        to: lastEventDate,
      },
      doshaTypes: [DoshaType.VATA, DoshaType.PITTA, DoshaType.KAPHA],
    };
  }
}
