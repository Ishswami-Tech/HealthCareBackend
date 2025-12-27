import { Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@config';
import { UsersModule } from './services/users/users.module';
import { AuthModule } from './services/auth/auth.module';
import { HealthModule } from './services/health/health.module';
import { AppController } from './app.controller';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { ClinicModule } from './services/clinic/clinic.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';
import { LoggingControllersModule } from '@infrastructure/logging/logging-controllers.module';
import { AppService } from './app.service';
import { AppointmentsModule } from './services/appointments/appointments.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { QueueModule } from '@infrastructure/queue';
import { CommunicationModule } from '@communication/communication.module';
import { BillingModule } from './services/billing/billing.module';
import { EHRModule } from './services/ehr/ehr.module';
import { VideoModule } from './services/video/video.module';
import { ResilienceModule } from '@core/resilience';
import { ErrorsModule } from '@core/errors';
import { SecurityModule } from '@security/security.module';
import { EventsModule } from '@infrastructure/events';
import { CacheModule } from '@infrastructure/cache/cache.module';
// import { SessionModule } from '@core/session/session.module';
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
    // JWT is configured in AuthModule - no need for global registration here
    // This ensures all JWT operations use the same secret from ConfigService
    // Core modules must be loaded before communication modules to ensure LoggingService is available
    LoggingModule,
    LoggingControllersModule, // Separate module for controllers to avoid duplicate registration
    // Central event system - must be loaded early for event-driven architecture
    EventsModule,
    // Resilience, errors, and security modules
    ResilienceModule,
    ErrorsModule, // Provides CacheErrorHandler and HealthcareErrorsService globally
    SecurityModule,
    // Auth and user management
    AuthModule,
    UsersModule,
    // Core modules
    DatabaseModule,
    // CacheModule - Required for caching functionality (Dragonfly/Redis)
    // Use forRoot() to conditionally include CacheWarmingService (only in API, not worker)
    CacheModule.forRoot(),
    // SessionModule - Required for FastifySessionStoreAdapter
    // TEMPORARILY DISABLED: SessionModule disabled for debugging
    // SessionModule,

    // Business modules
    AppointmentsModule,
    ClinicModule,
    BillingModule,
    EHRModule,
    // Video consultation module (OpenVidu/Jitsi integration)
    VideoModule,
    // Unified Communication Module (includes all channels: socket, push, email, WhatsApp, SMS, listeners)
    CommunicationModule,
    // Support modules
    HealthModule,
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
