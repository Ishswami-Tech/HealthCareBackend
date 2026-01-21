import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';
import { DoctorsService } from './doctors.service';
import { DoctorsController } from './controllers/doctors.controller';

@Module({
  imports: [DatabaseModule, LoggingModule],
  controllers: [DoctorsController],
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}
