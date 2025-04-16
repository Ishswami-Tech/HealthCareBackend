import { Module } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { ClinicController } from './clinic.controller';
import { ClinicDatabaseService } from './clinic-database.service';
import { SharedModule } from '../../shared/shared.module';
import { JwtModule } from '@nestjs/jwt';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';

@Module({
  imports: [
    SharedModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    RateLimitModule
  ],
  controllers: [ClinicController],
  providers: [ClinicService, ClinicDatabaseService],
  exports: [ClinicService, ClinicDatabaseService],
})
export class ClinicModule {} 