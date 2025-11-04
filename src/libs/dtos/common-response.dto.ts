import { ApiProperty } from '@nestjs/swagger';

/**
 * Base response Data Transfer Object
 * @class BaseResponseDto
 * @description Provides common structure for all API responses
 * @example
 * ```typescript
 * const response = new BaseResponseDto("Operation completed successfully");
 * response.status = "success";
 * response.timestamp = "2024-01-01T00:00:00.000Z";
 * ```
 */
export class BaseResponseDto {
  @ApiProperty({
    description: 'Response status',
    example: 'success',
    enum: ['success', 'error'],
  })
  status: string = 'success';

  @ApiProperty({
    description: 'Response message',
    example: 'Operation completed successfully',
  })
  message: string = '';

  @ApiProperty({
    description: 'Response timestamp in ISO format',
    example: '2024-01-01T00:00:00.000Z',
  })
  timestamp: string = '';

  @ApiProperty({
    description: 'Request correlation ID for tracing',
    example: 'req_123456789',
    required: false,
  })
  correlationId?: string;

  constructor(message: string, status: string = 'success') {
    this.status = status;
    this.message = message;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Data Transfer Object for pagination metadata
 * @class PaginationMetaDto
 * @description Contains pagination information for list responses
 * @example
 * ```typescript
 * const meta = new PaginationMetaDto(1, 10, 100);
 * meta.totalPages = 10;
 * meta.hasNext = true;
 * ```
 */
export class PaginationMetaDto {
  @ApiProperty({
    description: 'Current page number (1-based)',
    example: 1,
    minimum: 1,
  })
  page: number = 1;

  @ApiProperty({
    description: 'Items per page',
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  limit: number = 10;

  @ApiProperty({
    description: 'Total number of items',
    example: 100,
  })
  total: number = 0;

  @ApiProperty({
    description: 'Total number of pages',
    example: 10,
  })
  totalPages: number = 0;

  @ApiProperty({
    description: 'Whether there is a next page',
    example: true,
  })
  hasNext: boolean = false;

  @ApiProperty({
    description: 'Whether there is a previous page',
    example: false,
  })
  hasPrev: boolean = false;

  constructor(page: number = 1, limit: number = 10, total: number = 0) {
    this.page = page;
    this.limit = limit;
    this.total = total;
    this.totalPages = Math.ceil(total / limit);
    this.hasNext = page < this.totalPages;
    this.hasPrev = page > 1;
  }
}

/**
 * Data Transfer Object for paginated list responses
 * @class PaginatedResponseDto
 * @description Generic DTO for paginated data responses
 * @template T Type of items in the data array
 * @extends BaseResponseDto
 * @example
 * ```typescript
 * const response = new PaginatedResponseDto(users, meta, "Users retrieved successfully");
 * ```
 */
export class PaginatedResponseDto<T> extends BaseResponseDto {
  @ApiProperty({
    description: 'Response data array',
  })
  data: T[] = [];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  meta: PaginationMetaDto = new PaginationMetaDto();

  constructor(data: T[], meta: PaginationMetaDto, message: string = 'Data retrieved successfully') {
    super(message);
    this.data = data;
    this.meta = meta;
  }
}

/**
 * Data Transfer Object for single data responses
 * @class DataResponseDto
 * @description Generic DTO for single item responses
 * @template T Type of the data object
 * @extends BaseResponseDto
 * @example
 * ```typescript
 * const response = new DataResponseDto(user, "User retrieved successfully");
 * ```
 */
export class DataResponseDto<T> extends BaseResponseDto {
  @ApiProperty({
    description: 'Response data',
  })
  data: T = {} as T;

  constructor(data: T, message: string = 'Operation completed successfully') {
    super(message);
    this.data = data;
  }
}

/**
 * Data Transfer Object for error responses
 * @class ErrorResponseDto
 * @description Provides consistent structure for error responses
 * @extends BaseResponseDto
 * @example
 * ```typescript
 * const error = new ErrorResponseDto("Validation failed", "VALIDATION_ERROR", details, 400);
 * ```
 */
export class ErrorResponseDto extends BaseResponseDto {
  @ApiProperty({
    description: 'Error code for client handling',
    example: 'VALIDATION_ERROR',
    required: false,
  })
  errorCode?: string;

  @ApiProperty({
    description: 'Detailed error information',
    example: {},
    required: false,
  })
  details?: unknown;

  @ApiProperty({
    description: 'HTTP status code',
    example: 400,
    required: false,
  })
  statusCode?: number;

  constructor(message: string, errorCode?: string, details?: unknown, statusCode?: number) {
    super(message, 'error');
    this.errorCode = errorCode || '';
    this.details = details;
    this.statusCode = statusCode || 500;
  }
}

/**
 * Data Transfer Object for simple success responses
 * @class SuccessResponseDto
 * @description Provides simple success response structure
 * @extends BaseResponseDto
 * @example
 * ```typescript
 * const success = new SuccessResponseDto("Operation completed successfully");
 * ```
 */
export class SuccessResponseDto extends BaseResponseDto {
  @ApiProperty({
    description: 'Success indicator',
    example: true,
  })
  success: boolean = true;

  constructor(message: string = 'Operation completed successfully') {
    super(message, 'success');
    this.success = true;
  }
}
