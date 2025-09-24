import { ApiProperty } from "@nestjs/swagger";

/**
 * Base response DTO following NestJS best practices
 * Based on AI rules: @nestjs-specific.md and @coding-standards.md
 */
export class BaseResponseDto {
  @ApiProperty({
    description: "Response status",
    example: "success",
    enum: ["success", "error"],
  })
  status: string = "success";

  @ApiProperty({
    description: "Response message",
    example: "Operation completed successfully",
  })
  message: string = "";

  @ApiProperty({
    description: "Response timestamp in ISO format",
    example: "2024-01-01T00:00:00.000Z",
  })
  timestamp: string = "";

  @ApiProperty({
    description: "Request correlation ID for tracing",
    example: "req_123456789",
    required: false,
  })
  correlationId?: string;

  constructor(message: string, status: string = "success") {
    this.status = status;
    this.message = message;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Pagination metadata DTO
 */
export class PaginationMetaDto {
  @ApiProperty({
    description: "Current page number (1-based)",
    example: 1,
    minimum: 1,
  })
  page: number = 1;

  @ApiProperty({
    description: "Items per page",
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  limit: number = 10;

  @ApiProperty({
    description: "Total number of items",
    example: 100,
  })
  total: number = 0;

  @ApiProperty({
    description: "Total number of pages",
    example: 10,
  })
  totalPages: number = 0;

  @ApiProperty({
    description: "Whether there is a next page",
    example: true,
  })
  hasNext: boolean = false;

  @ApiProperty({
    description: "Whether there is a previous page",
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
 * Paginated response DTO for list endpoints
 */
export class PaginatedResponseDto<T> extends BaseResponseDto {
  @ApiProperty({
    description: "Response data array",
  })
  data: T[] = [];

  @ApiProperty({
    description: "Pagination metadata",
    type: PaginationMetaDto,
  })
  meta: PaginationMetaDto = new PaginationMetaDto();

  constructor(
    data: T[],
    meta: PaginationMetaDto,
    message: string = "Data retrieved successfully",
  ) {
    super(message);
    this.data = data;
    this.meta = meta;
  }
}

/**
 * Single data response DTO for detail endpoints
 */
export class DataResponseDto<T> extends BaseResponseDto {
  @ApiProperty({
    description: "Response data",
  })
  data: T = {} as T;

  constructor(data: T, message: string = "Operation completed successfully") {
    super(message);
    this.data = data;
  }
}

/**
 * Error response DTO for consistent error handling
 */
export class ErrorResponseDto extends BaseResponseDto {
  @ApiProperty({
    description: "Error code for client handling",
    example: "VALIDATION_ERROR",
    required: false,
  })
  errorCode?: string;

  @ApiProperty({
    description: "Detailed error information",
    example: {},
    required: false,
  })
  details?: any;

  @ApiProperty({
    description: "HTTP status code",
    example: 400,
    required: false,
  })
  statusCode?: number;

  constructor(
    message: string,
    errorCode?: string,
    details?: any,
    statusCode?: number,
  ) {
    super(message, "error");
    this.errorCode = errorCode;
    this.details = details;
    this.statusCode = statusCode;
  }
}

/**
 * Success response DTO for simple success messages
 */
export class SuccessResponseDto extends BaseResponseDto {
  @ApiProperty({
    description: "Success indicator",
    example: true,
  })
  success: boolean = true;

  constructor(message: string = "Operation completed successfully") {
    super(message, "success");
    this.success = true;
  }
}
