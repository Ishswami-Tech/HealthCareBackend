import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNotEmpty, IsObject, ValidateNested, IsNumber, IsBoolean, IsDateString, IsArray } from 'class-validator';
import { Transform, Type } from 'class-transformer';

// Health status enum
export enum HealthStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  DEGRADED = 'degraded',
  MAINTENANCE = 'maintenance'
}

// Service status enum
export enum ServiceStatus {
  UP = 'up',
  DOWN = 'down',
  DEGRADED = 'degraded'
}

/**
 * Health check response DTO following NestJS best practices
 * Based on AI rules: @nestjs-specific.md and @coding-standards.md
 */
export class HealthCheckResponseDto {
  @ApiProperty({
    example: 'healthy',
    description: 'Overall health status of the system',
    enum: HealthStatus
  })
  @IsEnum(HealthStatus, { message: 'Status must be a valid health status' })
  status: HealthStatus;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Timestamp of the health check'
  })
  @IsDateString({}, { message: 'Timestamp must be a valid date string' })
  timestamp: string;

  @ApiProperty({
    example: 'Healthcare Backend API',
    description: 'Name of the service being checked'
  })
  @IsString({ message: 'Service name must be a string' })
  service: string;

  @ApiProperty({
    example: '1.0.0',
    description: 'Version of the service'
  })
  @IsString({ message: 'Version must be a string' })
  version: string;

  @ApiProperty({
    example: 'healthcare-backend',
    description: 'Environment where the service is running'
  })
  @IsString({ message: 'Environment must be a string' })
  environment: string;

  @ApiPropertyOptional({
    example: 'uptime: 24h, memory: 512MB',
    description: 'Additional health information'
  })
  @IsOptional()
  @IsString({ message: 'Details must be a string' })
  details?: string;
}

/**
 * Detailed health check response DTO
 */
export class DetailedHealthCheckResponseDto extends HealthCheckResponseDto {
  @ApiProperty({
    description: 'Health status of individual services',
    type: 'object',
    additionalProperties: true
  })
  @IsObject({ message: 'Services must be an object' })
  services: Record<string, ServiceHealthDto>;

  @ApiProperty({
    description: 'System metrics and performance data',
    type: 'object',
    additionalProperties: true
  })
  @IsObject({ message: 'Metrics must be an object' })
  metrics: SystemMetricsDto;

  @ApiProperty({
    example: 'healthcare',
    description: 'Application domain for multi-domain setup'
  })
  @IsString({ message: 'App domain must be a string' })
  appDomain: string;
}

/**
 * Individual service health DTO
 */
export class ServiceHealthDto {
  @ApiProperty({
    example: 'up',
    description: 'Status of the individual service',
    enum: ServiceStatus
  })
  @IsEnum(ServiceStatus, { message: 'Service status must be a valid status' })
  status: ServiceStatus;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Last check timestamp for this service'
  })
  @IsDateString({}, { message: 'Last check must be a valid date string' })
  lastCheck: string;

  @ApiPropertyOptional({
    example: 'Response time: 15ms',
    description: 'Additional service-specific information'
  })
  @IsOptional()
  @IsString({ message: 'Details must be a string' })
  details?: string;

  @ApiPropertyOptional({
    example: 15,
    description: 'Response time in milliseconds'
  })
  @IsOptional()
  @IsNumber({}, { message: 'Response time must be a number' })
  responseTime?: number;
}

/**
 * System metrics DTO
 */
export class SystemMetricsDto {
  @ApiProperty({
    example: 24,
    description: 'System uptime in hours'
  })
  @IsNumber({}, { message: 'Uptime must be a number' })
  uptime: number;

  @ApiProperty({
    example: 512,
    description: 'Memory usage in MB'
  })
  @IsNumber({}, { message: 'Memory usage must be a number' })
  memoryUsage: number;

  @ApiProperty({
    example: 2.5,
    description: 'CPU usage percentage'
  })
  @IsNumber({}, { message: 'CPU usage must be a number' })
  cpuUsage: number;

  @ApiProperty({
    example: 1000,
    description: 'Total requests processed'
  })
  @IsNumber({}, { message: 'Total requests must be a number' })
  totalRequests: number;

  @ApiProperty({
    example: 50,
    description: 'Active connections'
  })
  @IsNumber({}, { message: 'Active connections must be a number' })
  activeConnections: number;

  @ApiProperty({
    example: 99.9,
    description: 'System availability percentage'
  })
  @IsNumber({}, { message: 'Availability must be a number' })
  availability: number;
}

/**
 * Health check request DTO
 */
export class HealthCheckRequestDto {
  @ApiPropertyOptional({
    example: 'detailed',
    description: 'Type of health check to perform',
    enum: ['basic', 'detailed'],
    default: 'basic'
  })
  @IsOptional()
  @IsString({ message: 'Check type must be a string' })
  checkType?: string = 'basic';

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Application domain for multi-domain health checks',
    enum: ['healthcare', 'clinic']
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to include detailed metrics',
    default: false
  })
  @IsOptional()
  @IsBoolean({ message: 'Include metrics must be a boolean' })
  includeMetrics?: boolean = false;
}

/**
 * Service health update DTO
 */
export class ServiceHealthUpdateDto {
  @ApiProperty({
    example: 'database',
    description: 'Name of the service to update'
  })
  @IsString({ message: 'Service name must be a string' })
  @IsNotEmpty({ message: 'Service name is required' })
  serviceName: string;

  @ApiProperty({
    example: 'up',
    description: 'New status of the service',
    enum: ServiceStatus
  })
  @IsEnum(ServiceStatus, { message: 'Service status must be a valid status' })
  @IsNotEmpty({ message: 'Service status is required' })
  status: ServiceStatus;

  @ApiPropertyOptional({
    example: 'Connection restored',
    description: 'Reason for status change'
  })
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  @Transform(({ value }) => value?.trim())
  reason?: string;

  @ApiPropertyOptional({
    example: 25,
    description: 'Response time in milliseconds'
  })
  @IsOptional()
  @IsNumber({}, { message: 'Response time must be a number' })
  responseTime?: number;
}

/**
 * Health check configuration DTO
 */
export class HealthCheckConfigDto {
  @ApiProperty({
    example: 30000,
    description: 'Health check interval in milliseconds',
    default: 30000
  })
  @IsNumber({}, { message: 'Interval must be a number' })
  interval: number = 30000;

  @ApiProperty({
    example: 5000,
    description: 'Health check timeout in milliseconds',
    default: 5000
  })
  @IsNumber({}, { message: 'Timeout must be a number' })
  timeout: number = 5000;

  @ApiProperty({
    example: 3,
    description: 'Number of consecutive failures before marking unhealthy',
    default: 3
  })
  @IsNumber({}, { message: 'Failure threshold must be a number' })
  failureThreshold: number = 3;

  @ApiProperty({
    example: 2,
    description: 'Number of consecutive successes before marking healthy',
    default: 2
  })
  @IsNumber({}, { message: 'Success threshold must be a number' })
  successThreshold: number = 2;

  @ApiProperty({
    example: true,
    description: 'Whether to enable detailed health checks',
    default: false
  })
  @IsBoolean({ message: 'Enable detailed checks must be a boolean' })
  enableDetailedChecks: boolean = false;

  @ApiProperty({
    example: ['database', 'redis', 'external-api'],
    description: 'List of services to monitor',
    type: [String]
  })
  @IsArray({ message: 'Services must be an array' })
  @IsString({ each: true, message: 'Each service must be a string' })
  services: string[] = ['database', 'redis'];
}

/**
 * Health check summary DTO
 */
export class HealthCheckSummaryDto {
  @ApiProperty({
    example: 'healthy',
    description: 'Overall system health status',
    enum: HealthStatus
  })
  @IsEnum(HealthStatus, { message: 'Overall status must be a valid health status' })
  overallStatus: HealthStatus;

  @ApiProperty({
    example: 5,
    description: 'Total number of services monitored'
  })
  @IsNumber({}, { message: 'Total services must be a number' })
  totalServices: number;

  @ApiProperty({
    example: 4,
    description: 'Number of healthy services'
  })
  @IsNumber({}, { message: 'Healthy services must be a number' })
  healthyServices: number;

  @ApiProperty({
    example: 1,
    description: 'Number of unhealthy services'
  })
  @IsNumber({}, { message: 'Unhealthy services must be a number' })
  unhealthyServices: number;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Last health check timestamp'
  })
  @IsDateString({}, { message: 'Last check must be a valid date string' })
  lastCheck: string;

  @ApiProperty({
    example: 99.8,
    description: 'System availability percentage'
  })
  @IsNumber({}, { message: 'Availability must be a number' })
  availability: number;
}
