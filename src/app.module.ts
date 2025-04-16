import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from "@nestjs/config";
import { UsersModule } from "./services/users/users.module";
import { AuthModule } from "./services/auth/auth.module";
import { HealthModule } from "./services/health/health.module";
import { AppController } from "./app.controller";
import { CacheModule } from "./shared/cache/cache.module";
import { WhatsAppModule } from "./shared/messaging/whatsapp/whatsapp.module";
import { PrismaModule } from './shared/database/prisma/prisma.module';
import { ClinicModule } from './services/clinic/clinic.module';
import { ClinicContextMiddleware } from './shared/middleware/clinic-context.middleware';
import { LoggingModule } from './shared/logging/logging.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    HealthModule,
    CacheModule,
    WhatsAppModule,
    PrismaModule,
    ClinicModule,
    LoggingModule,
  ],
  controllers: [AppController],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply the clinic context middleware to all routes
    consumer
      .apply(ClinicContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
