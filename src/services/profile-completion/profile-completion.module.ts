/**
 * Profile Completion Module
 * @class ProfileCompletionModule
 * @description Module for profile completion functionality
 * Provides ProfileCompletionService and ProfileCompletionController
 */

import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@config';
import { CacheModule } from '@infrastructure/cache';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { ErrorsModule } from '@core/errors/errors.module';
import { ProfileCompletionController } from './profile-completion.controller';
import { ProfileCompletionService } from './profile-completion.service';
import { UsersModule } from '@services/users/users.module';

@Module({
  imports: [
    forwardRef(() => ConfigModule),
    forwardRef(() => DatabaseModule),
    forwardRef(() => CacheModule),
    forwardRef(() => LoggingModule),
    forwardRef(() => ErrorsModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [ProfileCompletionController],
  providers: [ProfileCompletionService],
  exports: [ProfileCompletionService],
})
export class ProfileCompletionModule {}
