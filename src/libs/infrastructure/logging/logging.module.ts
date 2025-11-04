import { Module, Global } from '@nestjs/common';
import { LoggingService } from './logging.service';
import { LoggingController } from './logging.controller';

@Global()
@Module({
  controllers: [LoggingController],
  providers: [LoggingService],
  exports: [LoggingService],
})
export class LoggingModule {}
