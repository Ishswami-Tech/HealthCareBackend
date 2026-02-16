import { Module } from '@nestjs/common';
import { PatientsController } from './controllers/patients.controller';
import { PatientsService } from './patients.service';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';
import { UsersModule } from '../users/users.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { StorageModule } from '@infrastructure/storage/storage.module';

@Module({
  imports: [DatabaseModule, LoggingModule, UsersModule, RbacModule, StorageModule],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
