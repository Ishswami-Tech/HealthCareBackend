/**
 * Visit Vitals Examination Service
 * @module VisitVitalsExamination
 * @description General Examination + Physical Measurement snapshot, one row per visit.
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
  UpsertVisitVitalsExaminationDto,
  VisitVitalsExaminationResponse,
} from '@dtos/patient-visit.dto';

type VitalsRow = Omit<VisitVitalsExaminationResponse, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};

type VitalsClient = PrismaTransactionClientWithDelegates & {
  patientVisit: {
    findFirst: (args: PrismaDelegateArgs) => Promise<{ id: string } | null>;
  };
  visitVitalsExamination: {
    upsert: (args: PrismaDelegateArgs) => Promise<VitalsRow>;
    findUnique: (args: PrismaDelegateArgs) => Promise<VitalsRow | null>;
  };
};

const NUMERIC_FIELDS = [
  'heightCm',
  'weightKg',
  'temperatureC',
  'pulse',
  'bpSystolic',
  'bpDiastolic',
  'rr',
  'painScore',
  'fbs',
  'ppbs',
  'pbs',
  'spo2',
  'neck',
  'chest',
  'upperAbs',
  'waist',
  'lowerAbs',
  'hips',
  'thighLeft',
  'thighRight',
  'calfLeft',
  'calfRight',
  'upperArmLeft',
  'upperArmRight',
] as const;

const TEXT_FIELDS = ['sleep', 'bowel', 'appetite'] as const;

@Injectable()
export class VisitVitalsExaminationService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  async upsertForVisit(
    visitId: string,
    clinicId: string,
    dto: UpsertVisitVitalsExaminationDto,
    recordedBy?: string
  ): Promise<VisitVitalsExaminationResponse> {
    await this.assertVisitInClinic(visitId, clinicId);

    const data: Record<string, number | string | null> = {};
    for (const field of NUMERIC_FIELDS) {
      const value = dto[field];
      if (value !== undefined) {
        data[field] = value;
      }
    }
    for (const field of TEXT_FIELDS) {
      const value = dto[field];
      if (value !== undefined) {
        data[field] = value.trim() ? value.trim() : null;
      }
    }
    if (dto.heightCm !== undefined || dto.weightKg !== undefined) {
      data['bmi'] = null;
    }

    const row = await this.databaseService.executeHealthcareWrite<VitalsRow>(
      async client => {
        const tc = client as unknown as VitalsClient;
        // BMI needs the merged (existing + incoming) height/weight, so read
        // the current row first when only one of the two is being changed.
        const existing = await tc.visitVitalsExamination.findUnique({
          where: { visitId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        const heightCm = dto.heightCm ?? existing?.heightCm ?? null;
        const weightKg = dto.weightKg ?? existing?.weightKg ?? null;
        data['bmi'] = this.computeBmi(heightCm, weightKg);

        return tc.visitVitalsExamination.upsert({
          where: { visitId } as PrismaDelegateArgs,
          create: { visitId, recordedBy: recordedBy ?? null, ...data } as PrismaDelegateArgs,
          update: { recordedBy: recordedBy ?? null, ...data } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: recordedBy || 'system',
        clinicId,
        resourceType: 'VISIT_VITALS_EXAMINATION',
        operation: 'UPSERT',
        resourceId: visitId,
        userRole: 'system',
        details: { visitId, fields: Object.keys(data) },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Visit vitals examination saved',
      'VisitVitalsExaminationService',
      { visitId, clinicId }
    );

    return this.toResponse(row);
  }

  async getForVisit(
    visitId: string,
    clinicId: string
  ): Promise<VisitVitalsExaminationResponse | null> {
    await this.assertVisitInClinic(visitId, clinicId);
    const row = await this.databaseService.executeHealthcareRead<VitalsRow | null>(async client => {
      const tc = client as unknown as VitalsClient;
      return tc.visitVitalsExamination.findUnique({
        where: { visitId } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    return row ? this.toResponse(row) : null;
  }

  private computeBmi(heightCm: number | null, weightKg: number | null): number | null {
    if (!heightCm || !weightKg || heightCm <= 0) {
      return null;
    }
    const heightM = heightCm / 100;
    return Number((weightKg / (heightM * heightM)).toFixed(2));
  }

  private async assertVisitInClinic(visitId: string, clinicId: string): Promise<void> {
    const visit = await this.databaseService.executeHealthcareRead<{ id: string } | null>(
      async client => {
        const tc = client as unknown as VitalsClient;
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

  private toResponse(row: VitalsRow): VisitVitalsExaminationResponse {
    return {
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
