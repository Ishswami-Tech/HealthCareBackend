import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { FHIR_JSON_CONTENT_TYPE } from '@services/fhir/fhir.constants';
import { buildOperationOutcome } from '@services/fhir/mappers/operation-outcome';

const SERVER_ERROR_FLOOR: number = HttpStatus.INTERNAL_SERVER_ERROR;
const GENERIC_SERVER_ERROR = 'The server could not complete the request';

/**
 * Scoped to FhirController (via @UseFilters): turns any error, including guard rejections,
 * into a FHIR OperationOutcome served as `application/fhir+json`. 5xx details are logged but
 * never returned to the caller.
 */
@Catch()
export class FhirExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggingService) {}

  catch(exception: Error, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const isServerError = status >= SERVER_ERROR_FLOOR;

    if (isServerError) {
      void this.logger.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'FHIR request failed',
        'FhirExceptionFilter',
        { error: exception.message, status }
      );
    }

    const diagnostics = isServerError ? GENERIC_SERVER_ERROR : exception.message;
    void reply
      .status(status)
      .type(FHIR_JSON_CONTENT_TYPE)
      .send(buildOperationOutcome(status, diagnostics));
  }
}
