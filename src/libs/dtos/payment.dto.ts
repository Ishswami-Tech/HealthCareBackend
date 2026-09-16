/**
 * Payment Provider Configuration DTOs
 * =====================================
 * DTOs for managing clinic payment provider configuration
 *
 * @module PaymentDto
 * @description Payment provider config request/response types
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsInt,
  IsObject,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentProvider } from '@core/types';

/**
 * DTO for provider credentials (subset of fields per provider)
 */
export class PaymentProviderCredentialsDto {
  @ApiPropertyOptional({ description: 'Razorpay Key ID' })
  @IsOptional()
  @IsString()
  razorpayKeyId?: string;

  @ApiPropertyOptional({ description: 'Razorpay Key Secret' })
  @IsOptional()
  @IsString()
  razorpayKeySecret?: string;

  @ApiPropertyOptional({ description: 'Cashfree App ID' })
  @IsOptional()
  @IsString()
  cashfreeAppId?: string;

  @ApiPropertyOptional({ description: 'Cashfree Secret Key' })
  @IsOptional()
  @IsString()
  cashfreeSecretKey?: string;

  @ApiPropertyOptional({ description: 'PhonePe Client ID' })
  @IsOptional()
  @IsString()
  phonepeClientId?: string;

  @ApiPropertyOptional({ description: 'PhonePe Client Secret' })
  @IsOptional()
  @IsString()
  phonepeClientSecret?: string;

  @ApiPropertyOptional({ description: 'PhonePe Salt / Webhook Password' })
  @IsOptional()
  @IsString()
  phonepeSalt?: string;
}

/**
 * DTO for a single provider in primary/fallback list
 */
export class PaymentProviderConfigDto {
  @ApiProperty({ description: 'Payment provider', enum: PaymentProvider })
  @IsNotEmpty()
  provider!: PaymentProvider;

  @ApiProperty({ description: 'Whether this provider is enabled' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ description: 'Provider credentials', type: PaymentProviderCredentialsDto })
  @IsObject()
  credentials!: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Provider priority (lower = higher)',
    minimum: 1,
    maximum: 10,
  })
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  priority?: number;
}

/**
 * DTO for updating clinic payment configuration
 */
export class UpdateClinicPaymentConfigDto {
  @ApiProperty({ description: 'Primary payment provider config', type: PaymentProviderConfigDto })
  @IsObject()
  primary!: PaymentProviderConfigDto;

  @ApiPropertyOptional({ description: 'Fallback providers', type: [PaymentProviderConfigDto] })
  @IsOptional()
  @Type(() => PaymentProviderConfigDto)
  fallback?: PaymentProviderConfigDto[];

  @ApiPropertyOptional({ description: 'Default currency', example: 'INR' })
  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @ApiPropertyOptional({ description: 'Default provider', enum: PaymentProvider })
  @IsOptional()
  defaultProvider?: PaymentProvider;
}

/**
 * DTO for verifying payment provider credentials
 */
export class VerifyPaymentProviderDto {
  @ApiProperty({ description: 'Payment provider', enum: PaymentProvider })
  @IsNotEmpty()
  provider!: PaymentProvider;

  @ApiProperty({
    description: 'Provider credentials to verify',
    type: PaymentProviderCredentialsDto,
  })
  @IsObject()
  credentials!: Record<string, string>;
}

/**
 * Response DTO for a provider (sanitized — no secrets)
 */
export class PaymentProviderResponseDto {
  @ApiProperty({ description: 'Payment provider', enum: PaymentProvider })
  provider!: PaymentProvider;

  @ApiProperty({ description: 'Whether this provider is enabled' })
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'Provider priority' })
  priority?: number;

  @ApiProperty({ description: 'Whether provider has credentials configured' })
  hasCredentials!: boolean;

  @ApiProperty({ description: 'Human-readable provider name' })
  providerName!: string;
}

/**
 * Response DTO for clinic payment configuration
 */
export class ClinicPaymentConfigResponseDto {
  @ApiProperty({ description: 'Clinic identifier' })
  clinicId!: string;

  @ApiProperty({ description: 'Primary payment provider', type: PaymentProviderResponseDto })
  primary!: PaymentProviderResponseDto;

  @ApiPropertyOptional({ description: 'Fallback providers', type: [PaymentProviderResponseDto] })
  fallback?: PaymentProviderResponseDto[];

  @ApiPropertyOptional({ description: 'Default currency' })
  defaultCurrency?: string;

  @ApiPropertyOptional({ description: 'Default provider', enum: PaymentProvider })
  defaultProvider?: PaymentProvider;
}

/**
 * Response DTO for provider verification
 */
export class VerifyPaymentProviderResponseDto {
  @ApiProperty({ description: 'Whether credentials are valid' })
  valid!: boolean;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  error?: string;

  @ApiPropertyOptional({ description: 'Provider-specific details (masked)' })
  details?: string;
}
