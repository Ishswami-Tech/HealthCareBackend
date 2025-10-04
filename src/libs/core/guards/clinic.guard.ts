import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../infrastructure/database/prisma/prisma.service";
import { LoggingService } from "../../infrastructure/logging/logging.service";
import {
  LogType,
  LogLevel,
} from "../../infrastructure/logging/types/logging.types";
import { ClinicIsolationService, ClinicContext } from "../../infrastructure/database/clinic-isolation.service";

// Type definitions for request objects
interface AuthenticatedUser {
  id?: string;
  sub?: string;
  role?: string;
  clinicId?: string;
  [key: string]: unknown;
}

interface ClinicRequest {
  url: string;
  method: string;
  user?: AuthenticatedUser;
  headers: {
    "x-clinic-id"?: string;
    "clinic-id"?: string;
    [key: string]: string | undefined;
  };
  query?: {
    clinicId?: string;
    clinic_id?: string;
    [key: string]: unknown;
  };
  params?: {
    clinicId?: string;
    clinic_id?: string;
    [key: string]: unknown;
  };
  body?: {
    clinicId?: string;
    [key: string]: unknown;
  };
  clinicId?: string;
  clinicContext?: {
    clinicName?: string;
    [key: string]: unknown;
  };
}

interface ClinicValidationResult {
  success: boolean;
  error?: string;
  clinicContext?: ClinicContext;
}

@Injectable()
export class ClinicGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private loggingService: LoggingService,
    private clinicIsolationService: ClinicIsolationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClinicRequest>();
    const user = request.user;

    // Log the request details for debugging
    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      `ClinicGuard processing request`,
      "ClinicGuard",
      {
        path: request.url,
        method: request.method,
        userId: user?.id,
        userRole: user?.role,
      },
    );

    // Check if this route is accessing clinic-specific resources
    const isClinicRoute = this.isClinicRoute(context);

    // If not a clinic route, allow access
    if (!isClinicRoute) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `Not a clinic route, allowing access`,
        "ClinicGuard",
        { path: request.url },
      );
      return true;
    }

    // For clinic routes, extract clinic ID from request
    const clinicId = this.extractClinicId(request);

    if (!clinicId) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.WARN,
        `Clinic ID required for clinic route`,
        "ClinicGuard",
        { path: request.url },
      );
      throw new ForbiddenException(
        "Clinic ID is required. Please provide clinic ID in header, query, or JWT token.",
      );
    }

    // Validate clinic access using ClinicIsolationService
    const clinicResult: ClinicValidationResult =
      await this.clinicIsolationService.validateClinicAccess(
        user?.sub || user?.id || "anonymous",
        clinicId,
      );

    if (!clinicResult.success) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.WARN,
        `Invalid clinic access`,
        "ClinicGuard",
        {
          path: request.url,
          clinicId,
          error: clinicResult.error,
        },
      );
      throw new ForbiddenException(
        `Clinic access denied: ${clinicResult.error}`,
      );
    }

    // Set clinic context in request for downstream use
    request.clinicId = clinicId;
    request.clinicContext = clinicResult.clinicContext as unknown as { [key: string]: unknown; clinicName?: string };

    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      `Clinic access validated`,
      "ClinicGuard",
      {
        userId: user?.sub || user?.id,
        userRole: user?.role,
        clinicId,
        clinicName: clinicResult.clinicContext?.clinicName,
      },
    );

    return true;
  }

  private isClinicRoute(context: ExecutionContext): boolean {
    // Get the controller and handler metadata to determine if this is a clinic route
    const isPublic = this.reflector.getAllAndOverride<boolean>("isPublic", [
      context.getHandler(),
      context.getClass(),
    ]);

    // If marked as public, it's not a clinic route
    if (isPublic) {
      return false;
    }

    // Get controller metadata to check if it's a clinic route
    const isClinicRoute = this.reflector.getAllAndOverride<boolean>(
      "isClinicRoute",
      [context.getHandler(), context.getClass()],
    );

    // If explicitly marked as a clinic route, return true
    if (isClinicRoute) {
      return true;
    }

    // Otherwise, check the route path to determine if it's a clinic route
    const request = context.switchToHttp().getRequest<ClinicRequest>();
    const path = request.url;

    // Clinic routes typically include /clinics/ or /appointments/ or similar
    const clinicRoutePatterns = [
      /\/appointments\//,
      /\/clinics\//,
      /\/doctors\//,
      /\/locations\//,
      /\/patients\//,
      /\/queue\//,
      /\/prescriptions\//,
    ];

    return clinicRoutePatterns.some((pattern) => pattern.test(path));
  }

  private extractClinicId(request: ClinicRequest): string | null {
    // Try to get clinic ID from various sources

    // 1. From headers
    const headerClinicId =
      request.headers["x-clinic-id"] || request.headers["clinic-id"];
    if (headerClinicId) {
      return headerClinicId;
    }

    // 2. From query parameters
    const queryClinicId = request.query?.clinicId || request.query?.clinic_id;
    if (queryClinicId) {
      return queryClinicId;
    }

    // 3. From JWT token (if user is authenticated)
    if (request.user?.clinicId) {
      return request.user.clinicId;
    }

    // 4. From route parameters
    const routeClinicId = request.params?.clinicId || request.params?.clinic_id;
    if (routeClinicId) {
      return routeClinicId;
    }

    // 5. From body (for POST/PUT requests)
    if (request.body?.clinicId) {
      return request.body.clinicId;
    }

    return null;
  }
}
