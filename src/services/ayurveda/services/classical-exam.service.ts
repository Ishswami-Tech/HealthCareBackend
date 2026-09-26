/**
 * Classical Examination Service
 * @module ClassicalExam
 * @description Per-visit, per-category findings for Ashtavidha / Dashavidha /
 * Srotas Pariksha, Samprapti Ghataka, Pain Assessment and Personal History.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import type {
  ClassicalExamFindingResponse,
  UpsertClassicalExamFindingDto,
} from '@services/ayurveda/dto/classical-exam.dto';

interface ClassicalExamFindingRow {
  id: string;
  visitId: string;
  examType: string;
  categoryKey: string;
  selectedOptions: string[];
  remark: string | null;
  recordedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type ClassicalExamClient = PrismaTransactionClientWithDelegates & {
  patientVisit: {
    findFirst: (args: PrismaDelegateArgs) => Promise<{ id: string } | null>;
  };
  classicalExamFinding: {
    upsert: (args: PrismaDelegateArgs) => Promise<ClassicalExamFindingRow>;
    findMany: (args: PrismaDelegateArgs) => Promise<ClassicalExamFindingRow[]>;
    deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  };
};

@Injectable()
export class ClassicalExamService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  async upsertFindings(
    visitId: string,
    clinicId: string,
    findings: UpsertClassicalExamFindingDto[],
    recordedBy?: string
  ): Promise<ClassicalExamFindingResponse[]> {
    await this.assertVisitInClinic(visitId, clinicId);

    const rows = await this.databaseService.executeHealthcareWrite<ClassicalExamFindingRow[]>(
      async client => {
        const tc = client as unknown as ClassicalExamClient;
        const results: ClassicalExamFindingRow[] = [];
        for (const finding of findings) {
          const remark = finding.remark?.trim() ? finding.remark.trim() : null;
          const selectedOptions = finding.selectedOptions.map(o => o.trim()).filter(Boolean);
          // A section save sends every category; an empty one means
          // "nothing recorded" — clear any previous row rather than storing
          // an empty finding.
          if (selectedOptions.length === 0 && !remark) {
            await tc.classicalExamFinding.deleteMany({
              where: {
                visitId,
                examType: finding.examType,
                categoryKey: finding.categoryKey,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
            continue;
          }
          const row = await tc.classicalExamFinding.upsert({
            where: {
              visitId_examType_categoryKey: {
                visitId,
                examType: finding.examType,
                categoryKey: finding.categoryKey,
              },
            } as PrismaDelegateArgs,
            create: {
              visitId,
              examType: finding.examType,
              categoryKey: finding.categoryKey,
              selectedOptions,
              remark,
              recordedBy: recordedBy ?? null,
            } as PrismaDelegateArgs,
            update: {
              selectedOptions,
              remark,
              recordedBy: recordedBy ?? null,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          results.push(row);
        }
        return results;
      },
      {
        userId: recordedBy || 'system',
        clinicId,
        resourceType: 'CLASSICAL_EXAM_FINDING',
        operation: 'UPSERT',
        resourceId: visitId,
        userRole: 'system',
        details: { visitId, count: findings.length },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Classical exam findings saved',
      'ClassicalExamService',
      { visitId, clinicId, count: rows.length }
    );

    return rows.map(row => this.toResponse(row));
  }

  async getFindingsForVisit(
    visitId: string,
    clinicId: string
  ): Promise<ClassicalExamFindingResponse[]> {
    await this.assertVisitInClinic(visitId, clinicId);

    const rows = await this.databaseService.executeHealthcareRead<ClassicalExamFindingRow[]>(
      async client => {
        const tc = client as unknown as ClassicalExamClient;
        return tc.classicalExamFinding.findMany({
          where: { visitId } as PrismaDelegateArgs,
          orderBy: [{ examType: 'asc' }, { categoryKey: 'asc' }] as unknown as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );

    return rows.map(row => this.toResponse(row));
  }

  private async assertVisitInClinic(visitId: string, clinicId: string): Promise<void> {
    const visit = await this.databaseService.executeHealthcareRead<{ id: string } | null>(
      async client => {
        const tc = client as unknown as ClassicalExamClient;
        return tc.patientVisit.findFirst({
          where: { id: visitId, clinicId } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (!visit) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }
  }

  private toResponse(row: ClassicalExamFindingRow): ClassicalExamFindingResponse {
    return {
      id: row.id,
      visitId: row.visitId,
      examType: row.examType as ClassicalExamFindingResponse['examType'],
      categoryKey: row.categoryKey,
      selectedOptions: row.selectedOptions ?? [],
      remark: row.remark ?? null,
      recordedBy: row.recordedBy ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
