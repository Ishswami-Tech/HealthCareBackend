import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('root')
@Controller()
export class AppController {
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
