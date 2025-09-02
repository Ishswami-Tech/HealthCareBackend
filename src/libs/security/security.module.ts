import { Module, forwardRef } from '@nestjs/common';
import { RateLimitModule } from './rate-limit/rate-limit.module';

@Module({
  imports: [RateLimitModule],
  exports: [RateLimitModule],
})
export class SecurityModule {}
