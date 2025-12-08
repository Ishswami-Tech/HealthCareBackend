/**
 * Search Module
 * =============
 * Module for database-based search capabilities
 *
 * @module SearchModule
 * @description Search infrastructure module using database queries
 */

import { Module } from '@nestjs/common';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { SearchService } from './search.service';

@Module({
  imports: [LoggingModule, DatabaseModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
