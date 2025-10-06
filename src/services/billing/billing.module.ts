import { Module } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { InvoicePDFService } from "./invoice-pdf.service";
import { BillingEventsListener } from "./billing.events";
import { BillingController } from "./controllers/billing.controller";
import { PrismaModule } from "../../libs/infrastructure/database/prisma/prisma.module";
import { GuardsModule } from "../../libs/core/guards/guards.module";
import { RateLimitModule } from "../../libs/utils/rate-limit/rate-limit.module";
import { EventsModule } from "../../libs/infrastructure/events/events.module";
import { RbacModule } from "../../libs/core/rbac/rbac.module";
import { LoggingServiceModule } from "../../libs/infrastructure/logging/logging-service.module";
import { ErrorsModule } from "../../libs/core/errors/errors.module";
import { WhatsAppModule } from "../../libs/communication/messaging/whatsapp/whatsapp.module";

@Module({
  imports: [
    PrismaModule,
    GuardsModule,
    RateLimitModule,
    EventsModule,
    RbacModule,
    LoggingServiceModule,
    ErrorsModule,
    WhatsAppModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, InvoicePDFService, BillingEventsListener],
  exports: [BillingService, InvoicePDFService],
})
export class BillingModule {}
