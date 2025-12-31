/**
 * Email Unsubscribe Controller
 * =============================
 * Handles email unsubscribe requests
 * Follows AWS SES best practices for unsubscribe management
 *
 * @module EmailUnsubscribeController
 * @description Email unsubscribe endpoint
 */

import { Controller, Get, Post, Query, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { EmailUnsubscribeService } from './email-unsubscribe.service';

class UnsubscribeDto {
  token!: string;
  email?: string;
}

@ApiTags('email')
@Controller('email')
export class EmailUnsubscribeController {
  constructor(private readonly unsubscribeService: EmailUnsubscribeService) {}

  @Get('unsubscribe')
  @ApiOperation({
    summary: 'Unsubscribe from emails',
    description:
      'Unsubscribe a user from receiving emails. Can be accessed via unsubscribe link in emails.',
  })
  @ApiQuery({
    name: 'token',
    required: true,
    description: 'Unsubscribe token (provided in email)',
  })
  @ApiQuery({
    name: 'email',
    required: false,
    description: 'Email address (optional, can be extracted from token)',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully unsubscribed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        email: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid token or email',
  })
  async unsubscribe(
    @Query('token') token: string,
    @Query('email') email?: string
  ): Promise<{ success: boolean; message: string; email?: string }> {
    const result = await this.unsubscribeService.unsubscribe(token, email);
    return result;
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unsubscribe from emails (POST)',
    description: 'Unsubscribe a user from receiving emails via POST request.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully unsubscribed',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid token or email',
  })
  async unsubscribePost(@Body() dto: UnsubscribeDto): Promise<{
    success: boolean;
    message: string;
    email?: string;
  }> {
    const result = await this.unsubscribeService.unsubscribe(dto.token, dto.email);
    return result;
  }

  @Get('unsubscribe/:token')
  @ApiOperation({
    summary: 'Unsubscribe from emails (token in path)',
    description: 'Unsubscribe a user from receiving emails using token in URL path.',
  })
  @ApiParam({
    name: 'token',
    required: true,
    description: 'Unsubscribe token',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully unsubscribed',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid token',
  })
  async unsubscribeByToken(@Param('token') token: string): Promise<{
    success: boolean;
    message: string;
    email?: string;
  }> {
    const result = await this.unsubscribeService.unsubscribe(token);
    return result;
  }
}
