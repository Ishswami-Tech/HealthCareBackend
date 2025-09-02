import { SetMetadata } from '@nestjs/common';
import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

export const CLINIC_KEY = 'clinic';
export const Clinic = () => SetMetadata(CLINIC_KEY, true);

export const ClinicId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    
    // Priority 1: Check Authorization header for clinic context
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (payload.clinicId) {
          return payload.clinicId;
        }
      } catch (error) {
        // Continue to other methods if JWT parsing fails
      }
    }

    // Priority 2: Check X-Clinic-ID header
    const clinicIdHeader = request.headers['x-clinic-id'];
    if (clinicIdHeader) {
      return clinicIdHeader;
    }

    // Priority 3: Check request body
    const clinicIdBody = request.body?.clinicId;
    if (clinicIdBody) {
      return clinicIdBody;
    }

    // Priority 4: Check query parameters
    const clinicIdQuery = request.query?.clinicId;
    if (clinicIdQuery) {
      return clinicIdQuery;
    }

    throw new BadRequestException('Clinic ID is required. Provide it via X-Clinic-ID header, request body, or query parameter.');
  },
);

export const OptionalClinicId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    
    // Priority 1: Check Authorization header for clinic context
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (payload.clinicId) {
          return payload.clinicId;
        }
      } catch (error) {
        // Continue to other methods if JWT parsing fails
      }
    }

    // Priority 2: Check X-Clinic-ID header
    const clinicIdHeader = request.headers['x-clinic-id'];
    if (clinicIdHeader) {
      return clinicIdHeader;
    }

    // Priority 3: Check request body
    const clinicIdBody = request.body?.clinicId;
    if (clinicIdBody) {
      return clinicIdBody;
    }

    // Priority 4: Check query parameters
    const clinicIdQuery = request.query?.clinicId;
    if (clinicIdQuery) {
      return clinicIdQuery;
    }

    return undefined;
  },
); 