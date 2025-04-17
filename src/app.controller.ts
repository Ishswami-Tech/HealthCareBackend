import { Controller, Get, Post, Body, UseGuards, Req, Res, HttpStatus, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './libs/decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './shared/database/prisma/prisma.service';
import { Role } from '@prisma/client';

@ApiTags('root')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {}

  @Get()
  @ApiOperation({ 
    summary: 'Redirect root to login',
    description: 'Redirects the user from the root path to the login page. No parameters required.'
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to login page'
  })
  @Redirect('/auth/login')
  getRoot() {
    return;
  }
}
