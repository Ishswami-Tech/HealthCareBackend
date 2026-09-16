/**
 * Ayurveda Module
 * @module Ayurveda
 * @description NestJS module wiring all Ayurvedic clinical data services
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { EventsModule } from '@infrastructure/events';
import { RbacModule } from '@core/rbac/rbac.module';

import { AyurvedaController } from '@services/ayurveda/ayurveda.controller';
import { AyurvedaService } from '@services/ayurveda/ayurveda.service';
import { PrakritiAssessmentService } from '@services/ayurveda/services/prakriti-assessment.service';
import { NadiParikshaService } from '@services/ayurveda/services/nadi-pariksha.service';
import { AyurvedicDiagnosisService } from '@services/ayurveda/services/ayurvedic-diagnosis.service';
import { SampraptiService } from '@services/ayurveda/services/samprapti.service';
import { DoshaImbalanceService } from '@services/ayurveda/services/dosha-imbalance.service';
import { AyurvedicTimelineService } from '@services/ayurveda/services/ayurvedic-timeline.service';

/**
 * NestJS module for Ayurvedic clinical data APIs.
 *
 * Provides:
 * - Prakriti assessment (constitution analysis)
 * - Nadi Pariksha (pulse diagnosis)
 * - Ayurvedic diagnosis with linked Prakriti/Nadi/Samprapti
 * - Samprapti (disease pathogenesis) tracking
 * - Dosha imbalance recording
 * - Longitudinal Ayurvedic timeline aggregation
 *
 * Required permissions:
 * - AYURVEDA_READ: Read Ayurvedic records
 * - AYURVEDA_WRITE: Create/update Ayurvedic records
 * - AYURVEDA_DELETE: Delete Ayurvedic records
 *
 * @public
 */
@Module({
  imports: [DatabaseModule, CacheModule, LoggingModule, ErrorsModule, EventsModule, RbacModule],
  controllers: [AyurvedaController],
  providers: [
    AyurvedaService,
    PrakritiAssessmentService,
    NadiParikshaService,
    AyurvedicDiagnosisService,
    SampraptiService,
    DoshaImbalanceService,
    AyurvedicTimelineService,
  ],
  exports: [AyurvedaService],
})
export class AyurvedaModule {}
