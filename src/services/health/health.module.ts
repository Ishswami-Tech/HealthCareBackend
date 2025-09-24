import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { PrismaModule } from "../../libs/infrastructure/database/prisma/prisma.module";
import { LoggingModule } from "../../libs/infrastructure/logging";
import { SocketModule } from "../../libs/communication/socket/socket.module";
import { EmailModule } from "../../libs/communication/messaging/email/email.module";
import { ErrorsModule } from "../../libs/core/errors/errors.module";

@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    SocketModule,
    EmailModule,
    ErrorsModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
