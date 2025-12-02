import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './controllers/users.controller';
import { ClinicContextService } from './core/clinic-context.service';
import { DatabaseModule } from '@infrastructure/database';
import { GuardsModule } from '@core/guards/guards.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { AuthModule } from '@services/auth/auth.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { CacheModule } from '@infrastructure/cache/cache.module';

@Module({
  imports: [
    DatabaseModule,
    GuardsModule,
    RateLimitModule,
    EventsModule,
    RbacModule,
    AuthModule,
    LoggingModule,
    ErrorsModule,
    CacheModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, ClinicContextService],
  exports: [UsersService, ClinicContextService],
})
export class UsersModule {}
