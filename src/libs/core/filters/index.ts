/**
 * Filters Module Exports
 *
 * @module Filters
 * @description Exception filters and error handling for healthcare applications
 */
export { HttpExceptionFilter } from './http-exception.filter';
export type {
  AuthenticatedUser,
  RequestHeaders,
  CustomFastifyRequest,
  ErrorLog,
  ErrorResponse,
} from '@core/types/infrastructure.types';
