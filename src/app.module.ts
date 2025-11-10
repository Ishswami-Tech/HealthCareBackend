import { Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@config';
import { UsersModule } from './services/users/users.module';
import { AuthModule } from './services/auth/auth.module';
import { HealthModule } from './services/health/health.module';
import { AppController } from './app.controller';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { WhatsAppModule } from '@communication/messaging/whatsapp/whatsapp.module';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { ClinicModule } from './services/clinic/clinic.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';
import { JwtModule } from '@nestjs/jwt';
import { AppService } from './app.service';
import { AppointmentsModule } from './services/appointments/appointments.module';
import { BullBoardModule } from '@infrastructure/queue/src/bull-board/bull-board.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { QueueModule } from '@infrastructure/queue/src/queue.module';
import { SocketModule } from '@communication/socket/socket.module';
import { NotificationModule } from './services/notification/notification.module';
import { BillingModule } from './services/billing/billing.module';
import { EHRModule } from './services/ehr/ehr.module';
// import { ClinicContextMiddleware } from './libs/utils/middleware/clinic-context.middleware';

@Module({
  imports: [
    // ConfigModule is @Global() and already configured in config.module.ts
    ConfigModule,
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
    JwtModule.register({
      secret: process.env['JWT_SECRET'] || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    // Core modules must be loaded before SocketModule to ensure LoggingService is available
    LoggingModule,
    // Socket modules
    SocketModule,
    // Auth and user management
    AuthModule,
    UsersModule,
    // Core modules
    DatabaseModule,
    CacheModule,

    // Business modules
    AppointmentsModule,
    ClinicModule,
    BillingModule,
    EHRModule,
    // Communication modules
    NotificationModule,
    // Support modules
    HealthModule,
    WhatsAppModule,
    BullBoardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure() {
    // Apply clinic context middleware to all routes for clinic isolation
    // ClinicContextMiddleware implementation - currently using auth-based clinic isolation
    // consumer
    //   .apply(ClinicContextMiddleware)
    //   .forRoutes('*');
  }
}
