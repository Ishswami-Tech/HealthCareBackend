import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, MaxLength, MinLength } from 'class-validator';
import { REVIEW_LOGIN_DURATION_DAYS, type ReviewLoginDurationDays } from './review-login.service';

/** Turn on the app store review login for one phone number. */
export class EnableReviewLoginDto {
  @ApiProperty({
    description: 'Reviewer phone number, with country code',
    example: '+919876543210',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  phone!: string;

  @ApiProperty({ description: 'How long it stays on', enum: REVIEW_LOGIN_DURATION_DAYS })
  @Type(() => Number)
  @IsInt()
  @IsIn([...REVIEW_LOGIN_DURATION_DAYS])
  days!: ReviewLoginDurationDays;
}
