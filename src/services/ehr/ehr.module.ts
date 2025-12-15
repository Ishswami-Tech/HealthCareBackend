import { Module } from '@nestjs/common';
import { EHRService } from './ehr.service';
import { EHRController } from './controllers/ehr.controller';
import { EHRClinicController } from './controllers/ehr-clinic.controller';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { GuardsModule } from '@core/guards/guards.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { QueueModule } from '@queue/src/queue.module';

@Module({
  imports: [
    DatabaseModule,
    GuardsModule,
    RateLimitModule,
    EventsModule,
    RbacModule,
    LoggingModule,
    ErrorsModule,
    CacheModule,
    QueueModule, // Queue processing for lab reports, imaging, bulk imports
  ],
  controllers: [EHRController, EHRClinicController],
  providers: [EHRService],
  exports: [EHRService],
})
export class EHRModule {}
