import { Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
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
import { BullBoardModule } from '@infrastructure/queue/src/bull-board/bull-board.module';
import { CommunicationModule } from '@communication/communication.module';
import { BillingModule } from './services/billing/billing.module';
import { EHRModule } from './services/ehr/ehr.module';
import { VideoModule } from './services/video/video.module';
import { ResilienceModule } from '@core/resilience/resilience.module';
import { ErrorsModule } from '@core/errors';
import { SecurityModule } from '@security/security.module';
import { PharmacyModule } from './services/pharmacy/pharmacy.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { SessionModule } from '@core/session/session.module';
import { PatientsModule } from './services/patients/patients.module';
import { DoctorsModule } from './services/doctors/doctors.module';
import { StaffModule } from './services/staff/staff.module';
import { AnalyticsModule } from './services/analytics/analytics.module';
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
    BullBoardModule.forRoot(), // Queue dashboard at /queue-dashboard
    // Cache must initialize before logging so the log dashboard can persist and read entries.
    CacheModule.forRoot(),
    // JWT is configured in AuthModule - no need for global registration here
    // This ensures all JWT operations use the same secret from ConfigService
    // Core modules must be loaded before communication modules to ensure LoggingService and CacheService are available
    LoggingModule,
    LoggingControllersModule, // Separate module for controllers to avoid duplicate registration
    // Central event system - must be loaded early for event-driven architecture
    // EventService depends on LoggingService and CacheService, so they must be loaded first
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
    // SessionModule - @Global() module providing SessionManagementService for JwtAuthGuard
    // Required for FastifySessionStoreAdapter and session management throughout the app
    SessionModule,

    // Business modules
    AppointmentsModule,
    ClinicModule,
    BillingModule,
    EHRModule,
    PharmacyModule,
    // Video consultation module (OpenVidu/Jitsi integration)
    VideoModule,
    // Unified Communication Module (includes all channels: socket, push, email, WhatsApp, SMS, listeners)
    CommunicationModule,
    // Support modules
    HealthModule,
    PatientsModule,
    DoctorsModule,
    StaffModule,
    AnalyticsModule,
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
