import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'Welcome endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Welcome message',
    type: String,
  })
  getHello(): string {
    return 'Hello! Welcome to Healthcare API';
  }
}
