import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';
import { StaffService } from './staff.service';
import { StaffController } from './controllers/staff.controller';

@Module({
  imports: [DatabaseModule, LoggingModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
