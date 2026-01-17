/**
 * Logging DTOs
 * Data Transfer Objects for logging endpoints with validation
 * Follows .ai-rules/ coding standards and SOLID principles
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  Max,
  IsString,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LogType, LogLevel } from '@core/types';
import { PaginationMetaDto } from './common-response.dto';

/**
 * Query DTO for retrieving logs
 * @class GetLogsQueryDto
 * @description Validates query parameters for log retrieval with pagination
 */
export class GetLogsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter logs by type',
    enum: LogType,
    example: LogType.ERROR,
  })
  @IsOptional()
  @IsEnum(LogType, { message: 'Type must be a valid LogType enum value' })
  type?: LogType;

  @ApiPropertyOptional({
    description: 'Filter logs by level',
    enum: LogLevel,
    example: LogLevel.ERROR,
  })
  @IsOptional()
  @IsEnum(LogLevel, { message: 'Level must be a valid LogLevel enum value' })
  level?: LogLevel;

  @ApiPropertyOptional({
    description: 'Start time for log filtering (ISO 8601 format)',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'startTime must be a valid ISO 8601 date string' })
  startTime?: string;

  @ApiPropertyOptional({
    description: 'End time for log filtering (ISO 8601 format)',
    example: '2024-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'endTime must be a valid ISO 8601 date string' })
  endTime?: string;

  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of logs per page (up to 10000 to show all logs from cache)',
    example: 50,
    minimum: 1,
    maximum: 10000,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(10000, { message: 'limit must not exceed 10000' })
  limit?: number = 100;

  @ApiPropertyOptional({
    description: 'Search term to filter logs by message content',
    example: 'error',
  })
  @IsOptional()
  @IsString({ message: 'search must be a string' })
  search?: string;
}

/**
 * Query DTO for retrieving events
 * @class GetEventsQueryDto
 * @description Validates query parameters for event retrieval with pagination
 */
export class GetEventsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter events by type',
    example: 'user.loggedIn',
  })
  @IsOptional()
  @IsString({ message: 'type must be a string' })
  type?: string;

  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of events per page',
    example: 50,
    minimum: 1,
    maximum: 1000,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(1000, { message: 'limit must not exceed 1000' })
  limit?: number = 100;
}

/**
 * DTO for clearing logs
 * @class ClearLogsDto
 * @description Options for clearing logs
 */
export class ClearLogsDto {
  @ApiPropertyOptional({
    description: 'Whether to clear database logs (audit trail). Default: false (only clears cache)',
    example: false,
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'clearDatabase must be a boolean' })
  clearDatabase?: boolean = false;
}

/**
 * Response DTO for paginated logs
 * @class PaginatedLogsResponseDto
 * @description Response format for paginated log retrieval
 */
export class PaginatedLogsResponseDto {
  @ApiProperty({
    description: 'Array of log entries',
    type: 'array',
  })
  logs: unknown[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  meta: PaginationMetaDto;

  constructor(logs: unknown[], meta: PaginationMetaDto) {
    this.logs = logs;
    this.meta = meta;
  }
}

/**
 * Response DTO for paginated events
 * @class PaginatedEventsResponseDto
 * @description Response format for paginated event retrieval
 */
export class PaginatedEventsResponseDto {
  @ApiProperty({
    description: 'Array of event entries',
    type: 'array',
  })
  events: unknown[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  meta: PaginationMetaDto;

  constructor(events: unknown[], meta: PaginationMetaDto) {
    this.events = events;
    this.meta = meta;
  }
}
