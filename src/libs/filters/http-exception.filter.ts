import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    response.status(status).send({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest().url,
      ...(typeof exceptionResponse === 'object' ? exceptionResponse : { message: exceptionResponse }),
    });
  }
} 