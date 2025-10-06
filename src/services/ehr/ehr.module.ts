import { Module } from "@nestjs/common";
import { EHRService } from "./ehr.service";
import { EHRController } from "./controllers/ehr.controller";
import { EHRClinicController } from "./controllers/ehr-clinic.controller";
import { PrismaModule } from "../../libs/infrastructure/database/prisma/prisma.module";
import { GuardsModule } from "../../libs/core/guards/guards.module";
import { RateLimitModule } from "../../libs/utils/rate-limit/rate-limit.module";
import { EventsModule } from "../../libs/infrastructure/events/events.module";
import { RbacModule } from "../../libs/core/rbac/rbac.module";
import { LoggingServiceModule } from "../../libs/infrastructure/logging/logging-service.module";
import { ErrorsModule } from "../../libs/core/errors/errors.module";

@Module({
  imports: [
    PrismaModule,
    GuardsModule,
    RateLimitModule,
    EventsModule,
    RbacModule,
    LoggingServiceModule,
    ErrorsModule,
  ],
  controllers: [EHRController, EHRClinicController],
  providers: [EHRService],
  exports: [EHRService],
})
export class EHRModule {}
