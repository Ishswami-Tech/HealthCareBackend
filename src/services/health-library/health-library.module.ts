import { Module } from '@nestjs/common';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { HealthLibraryController } from '@services/health-library/health-library.controller';
import { HealthLibraryService } from '@services/health-library/health-library.service';

@Module({
  imports: [CacheModule, StorageModule, EventsModule],
  controllers: [HealthLibraryController],
  providers: [HealthLibraryService],
  exports: [HealthLibraryService],
})
export class HealthLibraryModule {}
