import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import type { FastifyRequestWithUser } from '@core/types/guard.types';
import { ValidationPipeConfig } from '@config/validation-pipe.config';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { EnableReviewLoginDto } from './core/review-login.dto';
import {
  ReviewLoginService,
  type ReviewLoginIssued,
  type ReviewLoginStatus,
} from './core/review-login.service';

/** Super admin controls for the app store review login. */
@Controller('auth/admin/review-login')
@ApiTags('auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@UsePipes(new ValidationPipe(ValidationPipeConfig.getOptions()))
@ApiBearerAuth()
export class ReviewLoginController {
  constructor(private readonly reviewLoginService: ReviewLoginService) {}

  @Get()
  @ApiOperation({ summary: 'Get the app store review login status (never the code)' })
  @ApiResponse({ status: 200 })
  async getStatus(): Promise<ReviewLoginStatus> {
    return this.reviewLoginService.getStatus();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @RateLimitAPI({ points: 10, duration: 3600 })
  @ApiOperation({
    summary: 'Turn on the review login',
    description: 'Generates a new code and returns it once. It cannot be read again.',
  })
  @ApiResponse({ status: 200 })
  async enable(
    @Body() body: EnableReviewLoginDto,
    @Req() req: FastifyRequestWithUser
  ): Promise<ReviewLoginIssued> {
    return this.reviewLoginService.enable(body.phone, body.days, this.actorId(req));
  }

  @Post('regenerate')
  @HttpCode(HttpStatus.OK)
  @RateLimitAPI({ points: 10, duration: 3600 })
  @ApiOperation({ summary: 'Generate a new review code; the old one stops working at once' })
  @ApiResponse({ status: 200 })
  async regenerate(@Req() req: FastifyRequestWithUser): Promise<ReviewLoginIssued> {
    return this.reviewLoginService.regenerate(this.actorId(req));
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Turn off the review login' })
  @ApiResponse({ status: 200 })
  async disable(@Req() req: FastifyRequestWithUser): Promise<ReviewLoginStatus> {
    return this.reviewLoginService.disable(this.actorId(req));
  }

  private actorId(req: FastifyRequestWithUser): string {
    return req.user?.sub || (req.user as { id?: string } | undefined)?.id || 'unknown';
  }
}
