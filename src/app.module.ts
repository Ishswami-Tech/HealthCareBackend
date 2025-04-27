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
import { QueueModule } from './shared/queue/queue.module';
import { APPOINTMENT_QUEUE, SERVICE_QUEUE } from './shared/queue/queue.constants';
import configuration from './config/configuration';
import { HealthController } from './services/health/health.controller';
import { SocketModule } from './shared/socket/socket.module';
import { AppointmentSocketModule } from './services/appointments/appointment-socket/appointment-socket.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    EventEmitterModule.forRoot({
      // Add WebSocket specific event emitter config
      wildcard: true,
      delimiter: '.',
      newListener: true,
      removeListener: true,
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
    ScheduleModule.forRoot(),
    QueueModule.forRoot(),
    QueueModule.register(),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    // Socket modules
    SocketModule,
    AppointmentSocketModule,
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
  providers: [AppService, HealthController],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply the clinic context middleware to all routes except queue-dashboard and socket.io
    consumer
      .apply(ClinicContextMiddleware)
      .exclude(
        { path: 'queue-dashboard', method: RequestMethod.ALL },
        { path: 'queue-dashboard/*path', method: RequestMethod.ALL },
        { path: 'socket.io', method: RequestMethod.ALL },
        { path: 'socket.io/*path', method: RequestMethod.ALL }
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
