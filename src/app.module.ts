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
import { JwtModule } from '@nestjs/jwt';
import { AppService } from './app.service';
import { AppointmentsModule } from './services/appointments/appointments.module';
import { SharedModule } from './shared/shared.module';
import { BullBoardModule } from './shared/queue/bull-board/bull-board.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    // Auth and user management
    AuthModule,
    UsersModule,
    // Core modules
    SharedModule,
    PrismaModule,
    CacheModule,

    // Business modules
    AppointmentsModule,
    ClinicModule,
    // Support modules
    HealthModule,
    WhatsAppModule,
    LoggingModule,
    BullBoardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply the clinic context middleware to all routes except queue-dashboard
    consumer
      .apply(ClinicContextMiddleware)
      .exclude(
        { path: 'queue-dashboard', method: RequestMethod.ALL },
        { path: 'queue-dashboard/(.*)', method: RequestMethod.ALL }
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
