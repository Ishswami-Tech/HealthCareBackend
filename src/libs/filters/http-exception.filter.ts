import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  private readonly ignored404Patterns = [
    /\.env(\.|$)/i, // any .env file
    /favicon\.ico$/i,
    /robots\.txt$/i,
    /sitemap\.xml$/i,
    /\/redmine\//i,
    /\/uploads\//i,
    /\/lib\//i,
    /\/sendgrid\.env$/i,
    /\/aws\.env$/i,
    /\/main\/\.env$/i,
    /\/docs\/\.env$/i,
    /\/client\/\.env$/i,
    /\/blogs\/\.env$/i,
    /\/shared\/\.env$/i,
    /\/download\/\.env$/i,
    /\/site\/\.env$/i,
    /\/sites\/\.env$/i,
    /\/web\/\.env$/i,
    /\/database\/\.env$/i,
    /\/backend\/\.env$/i,
    /\/geoserver\/web\//i,
    /\/webui\//i,
    /\/stacks$/i,
  ];

  private isIgnored404(path: string, status: number): boolean {
    if (status !== 404) return false;
    return this.ignored404Patterns.some((pattern) => pattern.test(path));
  }

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest();
    
    // Get status code and message
    const status = 
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    
    const exceptionResponse = 
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };
    
    // Log the error with appropriate detail level
    const errorLog = {
      path: request.url,
      method: request.method,
      statusCode: status,
      timestamp: new Date().toISOString(),
      message: exception.message || 'Internal server error',
      stack: exception.stack,
      body: this.sanitizeRequestBody(request.body),
      headers: this.sanitizeHeaders(request.headers),
      query: request.query,
      params: request.params,
    };
    
    if (status >= 500) {
      this.logger.error(`Server Error: ${exception.message || 'Internal server error'}`, errorLog);
    } else if (status === 404 && this.isIgnored404(request.url, status)) {
      // Skip logging for ignored 404 paths
      // Do nothing
    } else if (status >= 400) {
      this.logger.warn(`Client Error: ${exception.message || 'Bad request'}`, errorLog);
    }
    
    // Send appropriate response
    response.status(status).send({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(typeof exceptionResponse === 'object' ? exceptionResponse : { message: exceptionResponse }),
    });
  }
  
  // Remove sensitive data from request body for logging
  private sanitizeRequestBody(body: any): any {
    if (!body) return {};
    
    const sanitized = { ...body };
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'accessToken', 'refreshToken', 'credit_card', 'creditCard'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
  
  // Remove sensitive headers for logging
  private sanitizeHeaders(headers: any): any {
    if (!headers) return {};
    
    const sanitized = { ...headers };
    
    // Remove sensitive headers
    const sensitiveHeaders = ['authorization', 'cookie', 'x-session-id'];
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
} 