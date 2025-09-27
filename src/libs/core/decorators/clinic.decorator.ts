import { SetMetadata } from "@nestjs/common";
import {
  createParamDecorator,
  ExecutionContext,
  BadRequestException,
} from "@nestjs/common";

// Type definitions for request objects
interface NestJSRequest {
  headers: {
    authorization?: string;
    "x-clinic-id"?: string;
    [key: string]: string | undefined;
  };
  body?: {
    clinicId?: string;
    [key: string]: any;
  };
  query?: {
    clinicId?: string;
    [key: string]: string | string[] | undefined;
  };
}

interface JWTPayload {
  clinicId?: string;
  [key: string]: any;
}

export const CLINIC_KEY = "clinic";
export const Clinic = () => SetMetadata(CLINIC_KEY, true);

export const ClinicId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const request = ctx.switchToHttp().getRequest() as NestJSRequest;

    // Priority 1: Check Authorization header for clinic context
    const authHeader = request.headers?.authorization;
    if (
      authHeader &&
      typeof authHeader === "string" &&
      authHeader.startsWith("Bearer ")
    ) {
      try {
        const token = authHeader.substring(7);
        const tokenParts = token.split(".");
        if (tokenParts.length === 3) {
          const payload = JSON.parse(
            Buffer.from(tokenParts[1], "base64").toString(),
          ) as JWTPayload;
          if (payload.clinicId && typeof payload.clinicId === "string") {
            return payload.clinicId;
          }
        }
      } catch {
        // Continue to other methods if JWT parsing fails
      }
    }

    // Priority 2: Check X-Clinic-ID header
    const clinicIdHeader = request.headers?.["x-clinic-id"];
    if (clinicIdHeader && typeof clinicIdHeader === "string") {
      return clinicIdHeader;
    }

    // Priority 3: Check request body
    const clinicIdBody = request.body?.clinicId;
    if (clinicIdBody && typeof clinicIdBody === "string") {
      return clinicIdBody;
    }

    // Priority 4: Check query parameters
    const clinicIdQuery = request.query?.clinicId;
    if (clinicIdQuery && typeof clinicIdQuery === "string") {
      return clinicIdQuery;
    }

    throw new BadRequestException(
      "Clinic ID is required. Provide it via X-Clinic-ID header, request body, or query parameter.",
    );
  },
);

export const OptionalClinicId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const request = ctx.switchToHttp().getRequest() as NestJSRequest;

    // Priority 1: Check Authorization header for clinic context
    const authHeader = request.headers?.authorization;
    if (
      authHeader &&
      typeof authHeader === "string" &&
      authHeader.startsWith("Bearer ")
    ) {
      try {
        const token = authHeader.substring(7);
        const tokenParts = token.split(".");
        if (tokenParts.length === 3) {
          const payload = JSON.parse(
            Buffer.from(tokenParts[1], "base64").toString(),
          ) as JWTPayload;
          if (payload.clinicId && typeof payload.clinicId === "string") {
            return payload.clinicId;
          }
        }
      } catch {
        // Continue to other methods if JWT parsing fails
      }
    }

    // Priority 2: Check X-Clinic-ID header
    const clinicIdHeader = request.headers?.["x-clinic-id"];
    if (clinicIdHeader && typeof clinicIdHeader === "string") {
      return clinicIdHeader;
    }

    // Priority 3: Check request body
    const clinicIdBody = request.body?.clinicId;
    if (clinicIdBody && typeof clinicIdBody === "string") {
      return clinicIdBody;
    }

    // Priority 4: Check query parameters
    const clinicIdQuery = request.query?.clinicId;
    if (clinicIdQuery && typeof clinicIdQuery === "string") {
      return clinicIdQuery;
    }

    return undefined;
  },
);
