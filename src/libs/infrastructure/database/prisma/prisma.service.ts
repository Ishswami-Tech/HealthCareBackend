import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Scope,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
// Use dynamic import for PrismaClient to avoid module caching issues
// This allows PrismaClient to be loaded after prisma generate completes
// Prisma 7: Import from generated client location
import type { PrismaClient } from './generated/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

// Re-export PrismaClient type
// Note: We use composition instead of inheritance to avoid 'any' types
export type { PrismaClient } from '@prisma/client';

// Import types from centralized locations
import type {
  PermissionEntity,
  RbacRoleEntity,
  RolePermissionEntity,
  UserRoleEntity,
  UserWithRelations,
  AppointmentWithRelations,
  AppointmentTimeSlot,
  UserCreateInput,
  UserUpdateInput,
  UserWhereInput,
  AppointmentCreateInput,
  AppointmentUpdateInput,
  AppointmentWhereInput,
  BillingPlanWithRelations,
  SubscriptionWithRelations,
  InvoiceWithRelations,
  PaymentWithRelations,
  BillingPlanCreateInput,
  BillingPlanUpdateInput,
  BillingPlanWhereInput,
  SubscriptionCreateInput,
  SubscriptionUpdateInput,
  SubscriptionWhereInput,
  InvoiceCreateInput,
  InvoiceUpdateInput,
  InvoiceWhereInput,
  PaymentCreateInput,
  PaymentUpdateInput,
  PaymentWhereInput,
  Doctor,
  Patient,
  Receptionist,
  ClinicAdmin,
  SuperAdmin,
  Pharmacist,
  Therapist,
  LabTechnician,
  FinanceBilling,
  SupportStaff,
  Nurse,
  Counselor,
  Clinic,
  AuditLog,
  PrismaDelegateArgs,
  PrismaClientConstructorArgs,
  PrismaExtendArgs,
  PrismaQueryOperation,
  UserDelegate,
  AppointmentDelegate,
  PermissionDelegate,
  RbacRoleDelegate,
  RolePermissionDelegate,
  UserRoleDelegate,
  BillingPlanDelegate,
  SubscriptionDelegate,
  InvoiceDelegate,
  PaymentDelegate,
  DoctorDelegate,
  PatientDelegate,
  ReceptionistDelegate,
  ClinicAdminDelegate,
  SuperAdminDelegate,
  PharmacistDelegate,
  TherapistDelegate,
  LabTechnicianDelegate,
  FinanceBillingDelegate,
  SupportStaffDelegate,
  NurseDelegate,
  CounselorDelegate,
  ClinicDelegate,
  AuditLogDelegate,
  TransactionDelegate,
} from '@core/types';

// Comprehensive type-safe validators using direct Prisma types
const userIncludeValidator = {
  doctor: true,
  patient: true,
  receptionists: true,
  clinicAdmins: true,
  superAdmin: true,
  pharmacist: true,
  therapist: true,
  labTechnician: true,
  financeBilling: true,
  supportStaff: true,
  nurse: true,
  counselor: true,
} as const;

const appointmentIncludeValidator = {
  patient: {
    include: {
      user: true,
    },
  },
  doctor: {
    include: {
      user: true,
    },
  },
  clinic: true,
  location: true,
} as const;

const appointmentTimeSlotSelectValidator = {
  id: true,
  date: true,
  time: true,
  duration: true,
  status: true,
  priority: true,
} as const;

// PrismaDelegateArgs is now imported from @core/types

// Re-export types from centralized locations
export type {
  UserWithRelations,
  AppointmentWithRelations,
  AppointmentTimeSlot,
  UserCreateInput,
  UserUpdateInput,
  UserWhereInput,
  UserWhereUniqueInput,
  AppointmentCreateInput,
  AppointmentUpdateInput,
  AppointmentWhereInput,
  AppointmentWhereUniqueInput,
  BillingPlanWithRelations,
  SubscriptionWithRelations,
  InvoiceWithRelations,
  PaymentWithRelations,
  BillingPlanCreateInput,
  BillingPlanUpdateInput,
  BillingPlanWhereInput,
  SubscriptionCreateInput,
  SubscriptionUpdateInput,
  SubscriptionWhereInput,
  InvoiceCreateInput,
  InvoiceUpdateInput,
  InvoiceWhereInput,
  PaymentCreateInput,
  PaymentUpdateInput,
  PaymentWhereInput,
} from '@core/types';

// Type-safe operation results
// Note: These are type aliases for convenience, but methods should use explicit return types
// to avoid 'any' in union types from Prisma-generated types
export type UserFindUniqueResult = UserWithRelations | null;
export type UserFindManyResult = UserWithRelations[];
export type AppointmentFindUniqueResult = AppointmentWithRelations;
export type AppointmentFindManyResult = AppointmentWithRelations[];
export type AppointmentTimeSlotResult = AppointmentTimeSlot[];

/**
 * Strict type-safe wrapper for PrismaClient
 * Uses composition instead of inheritance to avoid Prisma's 'any' types
 *
 * IMPORTANT: Using DEFAULT scope (singleton) instead of REQUEST scope
 * because query strategies and other services need to inject this as a singleton.
 * Multi-tenant isolation is handled at the query level, not at the service level.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private prismaClient!: PrismaClient;
  private currentTenantId: string | null = null;

  // Direct delegate properties - initialized once in constructor to avoid repeated casts
  readonly user!: UserDelegate;
  readonly doctor!: DoctorDelegate;
  readonly patient!: PatientDelegate;
  readonly receptionist!: ReceptionistDelegate;
  readonly clinicAdmin!: ClinicAdminDelegate;
  readonly superAdmin!: SuperAdminDelegate;
  readonly pharmacist!: PharmacistDelegate;
  readonly therapist!: TherapistDelegate;
  readonly labTechnician!: LabTechnicianDelegate;
  readonly financeBilling!: FinanceBillingDelegate;
  readonly supportStaff!: SupportStaffDelegate;
  readonly nurse!: NurseDelegate;
  readonly counselor!: CounselorDelegate;
  readonly clinic!: ClinicDelegate;
  readonly appointment!: AppointmentDelegate;
  readonly auditLog!: AuditLogDelegate;
  readonly permission!: PermissionDelegate;
  readonly rbacRole!: RbacRoleDelegate;
  readonly rolePermission!: RolePermissionDelegate;
  readonly userRole!: UserRoleDelegate;
  readonly billingPlan!: BillingPlanDelegate;
  readonly subscription!: SubscriptionDelegate;
  readonly invoice!: InvoiceDelegate;
  readonly payment!: PaymentDelegate;
  readonly $transaction!: TransactionDelegate['$transaction'];
  private static connectionCount = 0;
  private static readonly MAX_CONNECTIONS = 500; // Optimized for 10M+ users (increased from 200)
  private static readonly CONNECTION_TIMEOUT = 5000; // 5 seconds timeout for connections
  private static readonly QUERY_TIMEOUT = 30000; // 30 seconds query timeout
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5; // Failures before circuit opens
  private static readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute circuit timeout
  private static instance: PrismaService | null = null;
  // Singleton PrismaClient instance shared across all PrismaService instances
  // This prevents connection pool exhaustion when using REQUEST scope
  private static sharedPrismaClient: PrismaClient | null = null;
  // Dedicated PrismaClient instance for health checks
  // Uses a separate connection pool to avoid interfering with regular operations
  private static healthCheckPrismaClient: PrismaClient | null = null;
  private static circuitBreakerFailures = 0;
  private static circuitBreakerLastFailure = 0;
  private static isCircuitOpen = false;

  /**
   * Dynamically import PrismaClient to avoid module caching issues
   * This ensures PrismaClient is loaded after prisma generate completes
   */
  private static async loadPrismaClient(): Promise<typeof PrismaClient> {
    const cwd = process.cwd();
    const customClientPath = path.join(
      cwd,
      'src',
      'libs',
      'infrastructure',
      'database',
      'prisma',
      'generated',
      'client'
    );
    const customClientIndex = path.join(customClientPath, 'index.js');

    // Try custom generated location first (Prisma 7 with custom output)
    if (fs.existsSync(customClientIndex)) {
      try {
        // Use file:// URL for absolute path imports in ESM
        const customModule = (await import(
          process.platform === 'win32'
            ? `file:///${customClientIndex.replace(/\\/g, '/')}`
            : `file://${customClientIndex}`
        )) as { PrismaClient?: typeof PrismaClient };
        if (customModule?.PrismaClient) {
          return customModule.PrismaClient;
        }
      } catch {
        // Fall through to default import
      }
    }

    try {
      // Dynamic import to get fresh PrismaClient from generated location
      const prismaModule = (await import('./generated/client')) as {
        PrismaClient: typeof PrismaClient;
      };
      return prismaModule.PrismaClient;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new HealthcareError(
        ErrorCode.DATABASE_CONNECTION_FAILED,
        `Failed to load PrismaClient: ${errorMessage}. Please ensure "prisma generate" has been run.`,
        undefined,
        { originalError: errorMessage },
        'PrismaService.loadPrismaClient'
      );
    }
  }

  /**
   * Module-level helper to create PrismaClient instance
   * Ensures PrismaClient is generated before creating instance
   * Provides comprehensive error handling for initialization issues
   * Handles pnpm's module resolution by checking multiple paths
   */
  private static createPrismaClientInstance(
    constructorArgs: PrismaClientConstructorArgs
  ): PrismaClient {
    try {
      // Clear require cache for @prisma/client to force reload
      // This ensures we get a fresh PrismaClient after prisma generate
      try {
        const modulePath = require.resolve('@prisma/client');
        delete require.cache[modulePath];
        // Also clear any sub-modules that might be cached
        Object.keys(require.cache).forEach(key => {
          if (key.includes('@prisma/client') || key.includes('.prisma')) {
            delete require.cache[key];
          }
        });
      } catch {
        // Module not in cache yet, that's fine
      }

      // Try to require @prisma/client directly
      // With pnpm, the generated client should be accessible through @prisma/client
      // Use createRequire for type-safe dynamic requires (CommonJS compatibility)
      // Dynamic require is necessary for Prisma client loading with pnpm
      const requireModule = createRequire(__filename);
      let prismaModule: { PrismaClient: typeof PrismaClient } | null = null;
      const cwd = process.cwd();

      // Try custom generated location first (Prisma 7 with custom output)
      const customClientPath = path.join(
        cwd,
        'src',
        'libs',
        'infrastructure',
        'database',
        'prisma',
        'generated',
        'client'
      );
      const customClientIndex = path.join(customClientPath, 'index.js');

      try {
        // Try custom location first
        if (fs.existsSync(customClientIndex)) {
          prismaModule = requireModule(customClientIndex) as { PrismaClient: typeof PrismaClient };
        } else if (fs.existsSync(customClientPath)) {
          // Try directory import
          prismaModule = requireModule(customClientPath) as { PrismaClient: typeof PrismaClient };
        } else {
          // Fall back to generated client location
          const fallbackPath = path.join(__dirname, 'generated', 'client');
          if (fs.existsSync(fallbackPath)) {
            prismaModule = requireModule(fallbackPath) as { PrismaClient: typeof PrismaClient };
          } else {
            // Last resort: try @prisma/client (might not work with custom output)
            prismaModule = requireModule('@prisma/client') as { PrismaClient: typeof PrismaClient };
          }
        }
      } catch (requireError) {
        // If require fails, try multiple fallback paths for pnpm
        const possiblePaths = [
          // Custom generated location (Prisma 7 with custom output)
          customClientIndex,
          customClientPath,
          // Standard location
          path.join(cwd, 'node_modules', '.prisma', 'client'),
          // pnpm store location (find dynamically)
          ...(() => {
            const paths: string[] = [];
            try {
              // Try to find pnpm's @prisma/client location
              const pnpmDir = path.join(cwd, 'node_modules', '.pnpm');
              if (fs.existsSync(pnpmDir)) {
                // Look for @prisma+client directories
                const entries = fs.readdirSync(pnpmDir);
                for (const entry of entries) {
                  if (entry.startsWith('@prisma+client@')) {
                    const prismaPath = path.join(
                      pnpmDir,
                      entry,
                      'node_modules',
                      '.prisma',
                      'client'
                    );
                    if (fs.existsSync(prismaPath)) {
                      paths.push(prismaPath);
                    }
                  }
                }
              }
            } catch {
              // Ignore errors when searching
            }
            return paths;
          })(),
        ];

        for (const clientPath of possiblePaths) {
          if (fs.existsSync(clientPath)) {
            try {
              prismaModule = requireModule(clientPath) as { PrismaClient: typeof PrismaClient };
              break;
            } catch {
              // Continue to next path
              continue;
            }
          }
        }

        if (!prismaModule) {
          throw new HealthcareError(
            ErrorCode.DATABASE_CONNECTION_FAILED,
            '@prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.',
            undefined,
            {
              originalError:
                requireError instanceof Error ? requireError.message : String(requireError),
              checkedPaths: possiblePaths,
            },
            'PrismaService'
          );
        }
      }

      const PrismaClientClass = prismaModule.PrismaClient;

      if (!PrismaClientClass || typeof PrismaClientClass !== 'function') {
        throw new HealthcareError(
          ErrorCode.DATABASE_CONNECTION_FAILED,
          '@prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.',
          undefined,
          {},
          'PrismaService'
        );
      }

      // PrismaClient will throw an error if not generated when you try to instantiate it
      // The error message from Prisma is: "@prisma/client did not initialize yet. Please run "prisma generate" and try to import it again."
      type PrismaClientConstructor = new (
        constructorArgs: PrismaClientConstructorArgs
      ) => PrismaClient;
      const PrismaClientConstructorClass = PrismaClientClass as unknown as PrismaClientConstructor;

      // Create instance - this will throw if PrismaClient wasn't generated
      const client = new PrismaClientConstructorClass(constructorArgs);

      // Verify the client is properly initialized by checking for delegates
      // This ensures PrismaClient was generated correctly
      if (!client || typeof client !== 'object') {
        throw new HealthcareError(
          ErrorCode.DATABASE_CONNECTION_FAILED,
          'Failed to create PrismaClient instance',
          undefined,
          {},
          'PrismaService'
        );
      }

      return client;
    } catch (error) {
      // Check if this is the Prisma initialization error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('did not initialize yet') ||
        errorMessage.includes('prisma generate') ||
        errorMessage.includes('Cannot find module') ||
        errorMessage.includes('MODULE_NOT_FOUND')
      ) {
        throw new HealthcareError(
          ErrorCode.DATABASE_CONNECTION_FAILED,
          '@prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.',
          undefined,
          { originalError: errorMessage },
          'PrismaService'
        );
      }

      // If error is already a HealthcareError, rethrow it
      if (error instanceof HealthcareError) {
        throw error;
      }

      // Wrap other errors
      throw new HealthcareError(
        ErrorCode.DATABASE_CONNECTION_FAILED,
        `Failed to create PrismaClient: ${errorMessage}. Please ensure "prisma generate" has been run.`,
        undefined,
        { originalError: errorMessage },
        'PrismaService'
      );
    }
  }

  /**
   * Module-level helper to extend PrismaClient
   * Isolates type assertions so ESLint treats them as boundaries
   */
  private static extendPrismaClient(
    client: PrismaClient,
    extendArgs: PrismaExtendArgs
  ): PrismaClient {
    type PrismaClientWithExtendsType = {
      $extends: (args: PrismaExtendArgs) => PrismaClient;
    };
    const clientWithExtends = client as unknown as PrismaClientWithExtendsType;
    // Extend client - TypeScript infers the correct type from $extends return
    return clientWithExtends.$extends(extendArgs);
  }

  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second
  private connectionPool: Map<string, Record<string, never>> = new Map();
  private poolSize = parseInt(process.env['DB_POOL_SIZE'] || '20', 10);
  private loggingService?: LoggingService;

  /**
   * Constructor for PrismaService
   * Initializes PrismaClient with optimizations and delegate properties
   *
   * @param loggingService - Optional logging service for HIPAA-compliant logging
   */
  constructor(
    @Optional() @Inject(forwardRef(() => LoggingService)) loggingService?: LoggingService
  ) {
    // Store logging service if provided
    if (loggingService) {
      this.loggingService = loggingService;
    }

    // With REQUEST scope, NestJS creates a new instance per request
    // We still need to initialize prismaClient on each instance
    // The singleton pattern is handled via static instance, but each request gets its own instance
    // Continue with initialization below

    // Create PrismaClient instance using composition
    const dbUrlValue = process.env['DATABASE_URL'];
    const nodeEnv = process.env['NODE_ENV'];
    const isProduction = nodeEnv === 'production';

    // Build log configuration array based on environment
    type LogLevel = 'error' | 'warn' | 'info' | 'query';
    type LogConfig = { emit: 'stdout'; level: LogLevel };
    const productionLogConfig: LogConfig[] = [
      { emit: 'stdout' as const, level: 'error' as const },
      { emit: 'stdout' as const, level: 'warn' as const },
    ];
    const developmentLogConfig: LogConfig[] = [
      { emit: 'stdout' as const, level: 'error' as const },
      { emit: 'stdout' as const, level: 'warn' as const },
      { emit: 'stdout' as const, level: 'info' as const },
    ];
    const logConfiguration: LogConfig[] = isProduction ? productionLogConfig : developmentLogConfig;

    // Prisma 7: Use adapter pattern for library engine type
    // Create PostgreSQL adapter with connection string
    let connectionString = dbUrlValue || process.env['DATABASE_URL'] || '';
    if (!connectionString) {
      throw new HealthcareError(
        ErrorCode.DATABASE_CONNECTION_FAILED,
        'DATABASE_URL environment variable is not set',
        undefined,
        {},
        'PrismaService.constructor'
      );
    }

    // Remove sslmode from connection string to handle SSL via Pool config
    // This ensures our SSL configuration takes precedence
    // Preserve other query parameters like connect_timeout
    connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, match => {
      // If this is the first parameter (starts with ?), keep the ?
      // Otherwise remove the & as well
      return match.startsWith('?') ? '?' : '';
    });

    // Create pg Pool with SSL configuration for Supabase
    // Handle self-signed certificates in development
    const poolConfig: {
      connectionString: string;
      ssl?: boolean | { rejectUnauthorized: boolean };
      max?: number;
      connectionTimeoutMillis?: number;
    } = {
      connectionString,
      max: 10, // Limit connections per Pool instance
      connectionTimeoutMillis: 10000, // 10 second connection timeout
    };

    // For Supabase/cloud databases, always configure SSL
    // In development, accept self-signed certificates to avoid connection errors
    if (connectionString.includes('supabase') || connectionString.includes('pooler.supabase.com')) {
      // In development, set rejectUnauthorized to false to accept self-signed certs
      // In production, use proper certificate validation
      poolConfig.ssl = isProduction ? { rejectUnauthorized: true } : { rejectUnauthorized: false };
    }

    const pool = new Pool(poolConfig);
    const adapter = new PrismaPg(pool);

    const prismaConstructorArgs: PrismaClientConstructorArgs = {
      log: logConfiguration,
      errorFormat: 'minimal' as const,
      adapter,
    };

    // Use singleton PrismaClient instance to prevent connection pool exhaustion
    // With REQUEST scope, each PrismaService instance would create its own PrismaClient
    // which would open its own connection pool, quickly exhausting available connections
    // By sharing a single PrismaClient instance, we maintain a single connection pool
    if (!PrismaService.sharedPrismaClient) {
      PrismaService.sharedPrismaClient =
        PrismaService.createPrismaClientInstance(prismaConstructorArgs);
    }

    // Direct assignment instead of Object.defineProperty to avoid access issues
    this.prismaClient = PrismaService.sharedPrismaClient;

    // Apply production optimizations
    const productionExtendArgs: PrismaExtendArgs = {
      query: {
        $allOperations(prismaOperation: PrismaQueryOperation): Promise<Record<string, never>> {
          // Extract operation properties with proper typing
          // Type guard to narrow operation to expected structure
          type ProductionOperationStructure = {
            args: Record<string, unknown>;
            query: (args: Record<string, unknown>) => Promise<Record<string, never>>;
          };
          const isValidProductionOperation = (op: unknown): op is ProductionOperationStructure => {
            return (
              op !== null &&
              op !== undefined &&
              typeof op === 'object' &&
              'args' in op &&
              'query' in op &&
              typeof (op as { query?: unknown }).query === 'function'
            );
          };

          if (!isValidProductionOperation(prismaOperation)) {
            throw new HealthcareError(
              ErrorCode.DATABASE_QUERY_FAILED,
              'Invalid PrismaQueryOperation structure',
              undefined,
              {},
              'PrismaService'
            );
          }

          const operationArgs: Record<string, unknown> = prismaOperation.args;
          const productionQueryFn: (
            args: Record<string, unknown>
          ) => Promise<Record<string, never>> = prismaOperation.query;

          // Circuit breaker pattern
          if (PrismaService.isCircuitOpen) {
            const currentTime = Date.now();
            if (
              currentTime - PrismaService.circuitBreakerLastFailure >
              PrismaService.CIRCUIT_BREAKER_TIMEOUT
            ) {
              PrismaService.isCircuitOpen = false;
              PrismaService.circuitBreakerFailures = 0;
            } else {
              throw new HealthcareError(
                ErrorCode.DATABASE_CONNECTION_FAILED,
                'Database circuit breaker is open',
                undefined,
                {},
                'PrismaService'
              );
            }
          }

          // Add query timeout in production
          if (process.env['NODE_ENV'] === 'production') {
            const productionQueryArgs: Record<string, unknown> = operationArgs;
            const productionQueryResultPromise = productionQueryFn(productionQueryArgs);
            const productionQueryResult: Promise<Record<string, never>> =
              productionQueryResultPromise;
            return Promise.race([
              productionQueryResult,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Query timeout')), PrismaService.QUERY_TIMEOUT)
              ),
            ]);
          }

          const nonProductionQueryArgs: Record<string, unknown> = operationArgs;
          const nonProductionQueryResultPromise = productionQueryFn(nonProductionQueryArgs);
          const nonProductionQueryResult: Promise<Record<string, never>> =
            nonProductionQueryResultPromise;
          return nonProductionQueryResult;
        },
      },
    };

    // Replace prismaClient with extended version using direct assignment
    this.prismaClient = PrismaService.extendPrismaClient(this.prismaClient, productionExtendArgs);

    // Initialize delegate properties using Object.defineProperty to break ESLint's type tracking
    // This approach sets properties directly without ESLint tracking through assignment
    const clientTyped = this.prismaClient as unknown as Record<string, unknown>;

    const assignDelegate = <TDelegate>(
      propertyName: string,
      targetProperty: keyof PrismaService
    ): void => {
      const delegateValue = clientTyped[propertyName];
      if (delegateValue === undefined || delegateValue === null) {
        throw new HealthcareError(
          ErrorCode.DATABASE_QUERY_FAILED,
          `Delegate '${propertyName}' not found on PrismaClient`,
          undefined,
          { propertyName },
          'PrismaService'
        );
      }
      // Use Object.defineProperty to set the property - breaks ESLint's assignment tracking
      Object.defineProperty(this, targetProperty, {
        value: delegateValue as TDelegate,
        writable: false,
        enumerable: true,
        configurable: false,
      });
    };

    // Assign all delegates using Object.defineProperty
    assignDelegate<UserDelegate>('user', 'user');
    assignDelegate<DoctorDelegate>('doctor', 'doctor');
    assignDelegate<PatientDelegate>('patient', 'patient');
    assignDelegate<ReceptionistDelegate>('receptionist', 'receptionist');
    assignDelegate<ClinicAdminDelegate>('clinicAdmin', 'clinicAdmin');
    assignDelegate<SuperAdminDelegate>('superAdmin', 'superAdmin');
    assignDelegate<PharmacistDelegate>('pharmacist', 'pharmacist');
    assignDelegate<TherapistDelegate>('therapist', 'therapist');
    assignDelegate<LabTechnicianDelegate>('labTechnician', 'labTechnician');
    assignDelegate<FinanceBillingDelegate>('financeBilling', 'financeBilling');
    assignDelegate<SupportStaffDelegate>('supportStaff', 'supportStaff');
    assignDelegate<NurseDelegate>('nurse', 'nurse');
    assignDelegate<CounselorDelegate>('counselor', 'counselor');
    assignDelegate<ClinicDelegate>('clinic', 'clinic');
    assignDelegate<AppointmentDelegate>('appointment', 'appointment');
    assignDelegate<AuditLogDelegate>('auditLog', 'auditLog');
    assignDelegate<PermissionDelegate>('permission', 'permission');
    assignDelegate<RbacRoleDelegate>('rbacRole', 'rbacRole');
    assignDelegate<RolePermissionDelegate>('rolePermission', 'rolePermission');
    assignDelegate<UserRoleDelegate>('userRole', 'userRole');
    assignDelegate<BillingPlanDelegate>('billingPlan', 'billingPlan');
    assignDelegate<SubscriptionDelegate>('subscription', 'subscription');
    assignDelegate<InvoiceDelegate>('invoice', 'invoice');
    assignDelegate<PaymentDelegate>('payment', 'payment');
    assignDelegate<TransactionDelegate['$transaction']>('$transaction', '$transaction');

    // Monitor queries only in development
    if (process.env['NODE_ENV'] !== 'production') {
      // Query monitoring will be handled via extensions
    }

    // Store the instance
    PrismaService.instance = this;

    // Tenant isolation will be handled via manual filtering in service methods
    // as $use middleware is deprecated
  }

  /**
   * Connect to the database
   */
  async $connect(): Promise<void> {
    const client = this.prismaClient as {
      $connect: () => Promise<void>;
    };
    await client.$connect();
  }

  /**
   * Disconnect from the database
   */
  async $disconnect(): Promise<void> {
    const client = this.prismaClient as {
      $disconnect: () => Promise<void>;
    };
    await client.$disconnect();
  }

  /**
   * Get a dedicated PrismaClient instance for health checks
   * This uses a separate connection pool to avoid interfering with regular operations
   * Health checks run continuously, so they need their own connection
   */
  static getHealthCheckClient(): PrismaClient {
    if (!PrismaService.healthCheckPrismaClient) {
      const dbUrlValue = process.env['DATABASE_URL'];
      const nodeEnv = process.env['NODE_ENV'];
      const isProduction = nodeEnv === 'production';

      // Build log configuration for health checks (minimal logging)
      type LogLevel = 'error' | 'warn';
      type LogConfig = { emit: 'stdout'; level: LogLevel };
      const logConfiguration: LogConfig[] = isProduction
        ? [{ emit: 'stdout' as const, level: 'error' as const }]
        : [{ emit: 'stdout' as const, level: 'error' as const }];

      // Prisma 7: Use adapter pattern for library engine type
      let connectionString = dbUrlValue || process.env['DATABASE_URL'] || '';
      if (!connectionString) {
        throw new HealthcareError(
          ErrorCode.DATABASE_CONNECTION_FAILED,
          'DATABASE_URL environment variable is not set for health check client',
          undefined,
          {},
          'PrismaService.getHealthCheckClient'
        );
      }

      // Remove sslmode from connection string to handle SSL via Pool config
      // Preserve other query parameters
      connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, match => {
        return match.startsWith('?') ? '?' : '';
      });

      // Create pg Pool with SSL configuration for health checks
      const healthCheckPoolConfig: {
        connectionString: string;
        max: number;
        ssl?: boolean | { rejectUnauthorized: boolean };
        connectionTimeoutMillis?: number;
      } = {
        connectionString,
        max: 2, // Minimal connections for health checks
        connectionTimeoutMillis: 5000, // 5 second timeout for health checks
      };

      // For Supabase/cloud databases, always configure SSL
      // In development, accept self-signed certificates to avoid connection errors
      if (
        connectionString.includes('supabase') ||
        connectionString.includes('pooler.supabase.com')
      ) {
        healthCheckPoolConfig.ssl = isProduction
          ? { rejectUnauthorized: true }
          : { rejectUnauthorized: false };
      }

      const healthCheckPool = new Pool(healthCheckPoolConfig);
      const healthCheckAdapter = new PrismaPg(healthCheckPool);

      const prismaConstructorArgs: PrismaClientConstructorArgs = {
        log: logConfiguration,
        errorFormat: 'minimal' as const,
        adapter: healthCheckAdapter,
      };

      PrismaService.healthCheckPrismaClient =
        PrismaService.createPrismaClientInstance(prismaConstructorArgs);
    }
    return PrismaService.healthCheckPrismaClient;
  }

  /**
   * Get the underlying Prisma client instance
   * This method provides access to the PrismaClient for services that need direct access
   */
  getPrismaClient(): PrismaService {
    return this;
  }

  /**
   * Check if PrismaClient has been generated by checking for the client directory
   * Handles both local development and Docker environments
   */
  private static isPrismaClientGenerated(): boolean {
    try {
      const isDocker = fs.existsSync('/.dockerenv');
      const cwd = process.cwd();

      // Possible Prisma client locations
      const possiblePaths = [
        // Standard location (works in both local and Docker)
        path.join(cwd, 'node_modules', '.prisma', 'client', 'index.js'),
        // Docker-specific paths
        isDocker ? '/app/node_modules/.prisma/client/index.js' : null,
        isDocker ? '/app/dist/node_modules/.prisma/client/index.js' : null,
        // Alternative locations
        path.join(cwd, 'dist', 'node_modules', '.prisma', 'client', 'index.js'),
        // Fallback to check directory existence
        path.join(cwd, 'node_modules', '.prisma', 'client'),
      ].filter((p): p is string => p !== null);

      // Check if any of the paths exist
      for (const clientPath of possiblePaths) {
        try {
          if (fs.existsSync(clientPath)) {
            // If it's a directory, check for index.js inside
            const stats = fs.statSync(clientPath);
            if (stats.isDirectory()) {
              const indexPath = path.join(clientPath, 'index.js');
              if (fs.existsSync(indexPath)) {
                return true;
              }
            } else if (stats.isFile()) {
              // It's the index.js file itself
              return true;
            }
          }
        } catch {
          // Continue to next path
          continue;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get the underlying raw PrismaClient for accessing models not exposed as delegates
   * Use this for models like therapyQueue, checkInLocation, etc. that are not typed delegates
   */
  getRawPrismaClient(): PrismaClient {
    // Ensure prismaClient is initialized before returning
    if (!this.prismaClient) {
      // Wait for PrismaClient to be generated with retry mechanism
      const maxRetries = 10;
      const retryDelay = 1000; // 1 second
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Check if PrismaClient has been generated before attempting to create instance
        if (!PrismaService.isPrismaClientGenerated()) {
          if (attempt < maxRetries - 1) {
            if (this.loggingService) {
              void this.loggingService.log(
                LogType.DATABASE,
                LogLevel.WARN,
                `PrismaClient not generated yet (attempt ${attempt + 1}/${maxRetries}), waiting ${retryDelay}ms...`,
                'PrismaService.getRawPrismaClient'
              );
            }
            // Use setTimeout in a promise to avoid blocking the event loop
            // Note: This is a synchronous method, so we use a busy wait but with a check
            const startWait = Date.now();
            while (Date.now() - startWait < retryDelay) {
              // Busy wait - this ensures we wait before retrying
              // In practice, this should only happen during startup
            }
            continue; // Retry
          } else {
            throw new HealthcareError(
              ErrorCode.DATABASE_CONNECTION_FAILED,
              `PrismaClient has not been generated after ${maxRetries} attempts. Please ensure "prisma generate" has been run.`,
              undefined,
              { attempts: maxRetries },
              'PrismaService.getRawPrismaClient'
            );
          }
        }

        try {
          // Initialize synchronously if not already done
          // This can happen with REQUEST scope when instance is created before onModuleInit
          const dbUrlValue = process.env['DATABASE_URL'];
          const nodeEnv = process.env['NODE_ENV'];
          const isProduction = nodeEnv === 'production';

          type LogLevel = 'error' | 'warn' | 'info' | 'query';
          type LogConfig = { emit: 'stdout'; level: LogLevel };
          const logConfig: LogConfig[] = isProduction
            ? [{ emit: 'stdout', level: 'error' }]
            : [
                { emit: 'stdout', level: 'query' },
                { emit: 'stdout', level: 'error' },
                { emit: 'stdout', level: 'warn' },
              ];

          // Prisma 7: Use adapter pattern for library engine type
          let connectionString = dbUrlValue || process.env['DATABASE_URL'] || '';
          if (!connectionString) {
            throw new HealthcareError(
              ErrorCode.DATABASE_CONNECTION_FAILED,
              'DATABASE_URL environment variable is not set',
              undefined,
              {},
              'PrismaService.getRawPrismaClient'
            );
          }

          // Remove sslmode from connection string to handle SSL via Pool config
          // Preserve other query parameters
          connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, match => {
            return match.startsWith('?') ? '?' : '';
          });

          // Create pg Pool with SSL configuration
          const poolConfig: {
            connectionString: string;
            ssl?: boolean | { rejectUnauthorized: boolean };
            max?: number;
            connectionTimeoutMillis?: number;
          } = {
            connectionString,
            max: 10,
            connectionTimeoutMillis: 10000,
          };

          // For Supabase/cloud databases, always configure SSL
          // In development, accept self-signed certificates to avoid connection errors
          const isProductionEnv = process.env['NODE_ENV'] === 'production';
          if (
            connectionString.includes('supabase') ||
            connectionString.includes('pooler.supabase.com')
          ) {
            poolConfig.ssl = isProductionEnv
              ? { rejectUnauthorized: true }
              : { rejectUnauthorized: false };
          }

          const pool = new Pool(poolConfig);
          const adapter = new PrismaPg(pool);

          const constructorArgs: PrismaClientConstructorArgs = {
            log: logConfig,
            errorFormat: 'minimal' as const,
            adapter,
          };

          this.prismaClient = PrismaService.createPrismaClientInstance(constructorArgs);

          // Verify client is properly initialized
          if (!this.prismaClient) {
            throw new HealthcareError(
              ErrorCode.DATABASE_CONNECTION_FAILED,
              'PrismaClient instance is null after creation',
              undefined,
              {},
              'PrismaService.getRawPrismaClient'
            );
          }

          // Success - break out of retry loop
          return this.prismaClient;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const errorMessage = lastError.message;

          // Check if this is the Prisma initialization error
          if (
            errorMessage.includes('did not initialize yet') ||
            errorMessage.includes('prisma generate')
          ) {
            // If not the last attempt, wait and retry
            if (attempt < maxRetries - 1) {
              if (this.loggingService) {
                void this.loggingService.log(
                  LogType.DATABASE,
                  LogLevel.WARN,
                  `PrismaClient not ready yet (attempt ${attempt + 1}/${maxRetries}), waiting ${retryDelay}ms...`,
                  'PrismaService.getRawPrismaClient'
                );
              }
              // Synchronous wait (blocking) - this is intentional to ensure PrismaClient is ready
              const startWait = Date.now();
              while (Date.now() - startWait < retryDelay) {
                // Busy wait - this ensures we wait before retrying
              }
              continue; // Retry
            }
            // Last attempt failed - throw error
            throw new HealthcareError(
              ErrorCode.DATABASE_CONNECTION_FAILED,
              `PrismaClient initialization failed after ${maxRetries} attempts: ${errorMessage}. Please ensure "prisma generate" has been run.`,
              undefined,
              { originalError: errorMessage, attempts: maxRetries },
              'PrismaService.getRawPrismaClient'
            );
          }

          // If it's already a HealthcareError, rethrow it
          if (error instanceof HealthcareError) {
            throw error;
          }

          // Wrap other errors
          throw new HealthcareError(
            ErrorCode.DATABASE_CONNECTION_FAILED,
            `Failed to initialize PrismaClient: ${errorMessage}. Please ensure "prisma generate" has been run.`,
            undefined,
            { originalError: errorMessage },
            'PrismaService.getRawPrismaClient'
          );
        }
      }

      // If we get here, all retries failed
      throw new HealthcareError(
        ErrorCode.DATABASE_CONNECTION_FAILED,
        `PrismaClient initialization failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}. Please ensure "prisma generate" has been run.`,
        undefined,
        { originalError: lastError?.message, attempts: maxRetries },
        'PrismaService.getRawPrismaClient'
      );
    }
    return this.prismaClient;
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  onModuleDestroy() {
    try {
      // Don't disconnect the shared PrismaClient here
      // With REQUEST scope, each PrismaService instance is destroyed after the request
      // but we want to keep the shared PrismaClient alive for other requests
      // The shared client will be disconnected when the application shuts down
      // via a proper cleanup mechanism (e.g., app shutdown hook)
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          'PrismaService instance destroyed (shared PrismaClient remains active)',
          'PrismaService'
        );
      }
    } catch (_error) {
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.ERROR,
          'Error during PrismaService destruction',
          'PrismaService',
          { error: _error instanceof Error ? _error.message : String(_error) }
        );
      }
    }
  }

  private async connectWithRetry(retryCount = 0): Promise<void> {
    try {
      // Check circuit breaker
      if (PrismaService.isCircuitOpen) {
        const now = Date.now();
        if (now - PrismaService.circuitBreakerLastFailure > PrismaService.CIRCUIT_BREAKER_TIMEOUT) {
          PrismaService.isCircuitOpen = false;
          PrismaService.circuitBreakerFailures = 0;
        } else {
          throw new HealthcareError(
            ErrorCode.DATABASE_CONNECTION_FAILED,
            'Database circuit breaker is open',
            undefined,
            {},
            'PrismaService'
          );
        }
      }

      await this.$connect();
      PrismaService.connectionCount++;
      // Reset circuit breaker on successful connection
      PrismaService.circuitBreakerFailures = 0;
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.INFO,
          `Successfully connected to database. Active connections: ${PrismaService.connectionCount}/${PrismaService.MAX_CONNECTIONS}`,
          'PrismaService'
        );
      }
    } catch (_error) {
      // Increment circuit breaker failures
      PrismaService.circuitBreakerFailures++;
      PrismaService.circuitBreakerLastFailure = Date.now();

      // Open circuit breaker if threshold reached
      if (PrismaService.circuitBreakerFailures >= PrismaService.CIRCUIT_BREAKER_THRESHOLD) {
        PrismaService.isCircuitOpen = true;
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.ERROR,
            'Database circuit breaker opened due to repeated failures',
            'PrismaService'
          );
        }
      }

      if (retryCount < this.maxRetries) {
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Failed to connect to database. Retrying in ${this.retryDelay * (retryCount + 1)}ms... (Attempt ${retryCount + 1}/${this.maxRetries})`,
            'PrismaService'
          );
        }
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retryCount + 1))); // Exponential backoff
        await this.connectWithRetry(retryCount + 1);
      } else {
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.ERROR,
            'Failed to connect to database after maximum retries',
            'PrismaService',
            { error: _error instanceof Error ? _error.message : String(_error) }
          );
        }
        throw _error;
      }
    }
  }

  /**
   * Get the current connection count
   * @returns The number of active database connections
   */
  static getConnectionCount(): number {
    return PrismaService.connectionCount;
  }

  /**
   * Check if we can create a new connection
   * @returns boolean indicating if a new connection can be created
   */
  static canCreateNewConnection(): boolean {
    return PrismaService.connectionCount < PrismaService.MAX_CONNECTIONS;
  }

  /**
   * Get connection pool health status
   * @returns Object with pool health metrics
   */
  static getPoolHealth() {
    return {
      activeConnections: PrismaService.connectionCount,
      maxConnections: PrismaService.MAX_CONNECTIONS,
      utilizationPercentage: (PrismaService.connectionCount / PrismaService.MAX_CONNECTIONS) * 100,
      circuitBreakerOpen: PrismaService.isCircuitOpen,
      circuitBreakerFailures: PrismaService.circuitBreakerFailures,
      isHealthy:
        PrismaService.connectionCount < PrismaService.MAX_CONNECTIONS * 0.9 &&
        !PrismaService.isCircuitOpen,
    };
  }

  /**
   * Reset circuit breaker manually (admin operation)
   */
  static resetCircuitBreaker() {
    PrismaService.isCircuitOpen = false;
    PrismaService.circuitBreakerFailures = 0;
    PrismaService.circuitBreakerLastFailure = 0;
  }

  /**
   * Execute database operation with connection pool management
   */
  async executePooledOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (!PrismaService.canCreateNewConnection() && PrismaService.connectionCount > 0) {
      // Connection pool full, wait and retry
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (PrismaService.isCircuitOpen) {
      throw new HealthcareError(
        ErrorCode.DATABASE_CONNECTION_FAILED,
        'Database service unavailable (circuit breaker open)',
        undefined,
        {},
        'PrismaService'
      );
    }

    try {
      const result = await operation();
      // Reset circuit breaker on successful operation
      if (PrismaService.circuitBreakerFailures > 0) {
        PrismaService.circuitBreakerFailures = Math.max(
          0,
          PrismaService.circuitBreakerFailures - 1
        );
      }
      return result;
    } catch (_error) {
      PrismaService.circuitBreakerFailures++;
      PrismaService.circuitBreakerLastFailure = Date.now();

      if (PrismaService.circuitBreakerFailures >= PrismaService.CIRCUIT_BREAKER_THRESHOLD) {
        PrismaService.isCircuitOpen = true;
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.ERROR,
            'Circuit breaker opened due to failures',
            'PrismaService',
            { error: _error instanceof Error ? _error.message : String(_error) }
          );
        }
      }
      throw _error;
    }
  }

  /**
   * Set the current tenant ID for this request
   * This will be used to automatically filter all database queries
   * to only include data for this tenant
   * @param tenantId The ID of the tenant
   */
  setCurrentTenantId(tenantId: string | null): void {
    if (this.loggingService) {
      if (tenantId) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          `Setting current tenant ID to ${tenantId}`,
          'PrismaService'
        );
      } else {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.DEBUG,
          'Clearing tenant ID - using global scope',
          'PrismaService'
        );
      }
    }
    this.currentTenantId = tenantId;
  }

  /**
   * Get the current tenant ID
   * @returns The current tenant ID or null if not set
   */
  getCurrentTenantId(): string | null {
    return this.currentTenantId;
  }

  /**
   * Clear the current tenant ID
   * This is useful for operations that should access all data
   * For example, administrative tasks
   */
  clearTenantId() {
    this.currentTenantId = null;
  }

  /**
   * Get a client instance for the specified clinic
   * Note: This is just a wrapper that sets the tenant context, not an actual separate connection
   * @param clinicId The ID of the clinic
   * @returns The Prisma client with tenant context set
   */
  getClinicClient(clinicId: string): PrismaService {
    // Set the tenant context
    this.setCurrentTenantId(clinicId);
    return this;
  }

  // Method to handle transactions with retries
  async executeWithRetry<T>(operation: () => Promise<T>, retryCount = 0): Promise<T> {
    try {
      return await operation();
    } catch (_error) {
      if (retryCount < this.maxRetries && this.isRetryableError(_error)) {
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.WARN,
            `Operation failed. Retrying in ${this.retryDelay}ms...`,
            'PrismaService',
            { retryCount, error: _error instanceof Error ? _error.message : String(_error) }
          );
        }
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.executeWithRetry(operation, retryCount + 1);
      }
      throw _error;
    }
  }

  // Helper method to determine if an error is retryable
  private isRetryableError(_error: unknown): boolean {
    return (
      _error instanceof Error &&
      _error.name === 'PrismaClientKnownRequestError' &&
      ((_error as { code?: string }).code === 'P2024' || // Connection pool timeout
        (_error as { code?: string }).code === 'P2028' || // Transaction timeout
        (_error as { code?: string }).code === 'P2025' || // Record not found
        (_error as { code?: string }).code === 'P2034') // Transaction failed
    );
  }

  // Method to get tenant-specific prisma instance
  withTenant(tenantId: string): PrismaClient {
    const extendArgs: PrismaExtendArgs = {
      query: {
        $allOperations(operation: PrismaQueryOperation) {
          // Extract operation properties with proper typing
          // Type guard to narrow operation to expected structure
          type TenantOperationStructure = {
            args: Record<string, unknown>;
            query: (args: Record<string, unknown>) => Promise<Record<string, never>>;
          };
          const isTenantOperationType = (op: unknown): op is TenantOperationStructure => {
            return (
              op !== null &&
              op !== undefined &&
              typeof op === 'object' &&
              'args' in op &&
              'query' in op &&
              typeof (op as { query?: unknown }).query === 'function'
            );
          };

          if (!isTenantOperationType(operation)) {
            throw new HealthcareError(
              ErrorCode.DATABASE_QUERY_FAILED,
              'Invalid PrismaQueryOperation structure',
              undefined,
              {},
              'PrismaService'
            );
          }

          const tenantOperationArgs: Record<string, unknown> = operation.args;
          const tenantQueryFn: (args: Record<string, unknown>) => Promise<Record<string, never>> =
            operation.query;

          // Add tenant context to all queries
          const tenantWhereClause =
            (tenantOperationArgs['where'] as Record<string, unknown> | undefined) ?? {};
          const tenantNewArgs: Record<string, unknown> = {
            ...tenantOperationArgs,
            where: { ...tenantWhereClause, tenantId },
          };
          const tenantQueryResultPromise = tenantQueryFn(tenantNewArgs);
          const tenantQueryResult: Promise<Record<string, never>> = tenantQueryResultPromise;
          return tenantQueryResult;
        },
      },
    };
    // Use module-level helper to extend client with tenant isolation
    return PrismaService.extendPrismaClient(this.prismaClient, extendArgs);
  }

  /**
   * Optimized query execution with timeout and retry logic
   */
  async executeOptimizedQuery<T>(
    queryFn: () => Promise<T>,
    timeout: number = PrismaService.QUERY_TIMEOUT
  ): Promise<T> {
    return Promise.race([
      queryFn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), timeout)
      ),
    ]);
  }

  /**
   * Batch operations for better performance
   */
  async executeBatch<T>(operations: (() => Promise<T>)[], batchSize: number = 10): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < operations.length; i += batchSize) {
      const batch = operations.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(operation => this.executeWithRetry(operation))
      );

      results.push(
        ...batchResults
          .filter(
            (result): result is PromiseFulfilledResult<Awaited<T>> => result.status === 'fulfilled'
          )
          .map(result => result.value)
      );
    }

    return results;
  }

  /**
   * Get connection health status
   */
  async getConnectionHealth(): Promise<{
    connected: boolean;
    connectionCount: number;
    maxConnections: number;
    health: 'healthy' | 'warning' | 'critical';
  }> {
    try {
      await this.$queryRaw`SELECT 1`;
      const health =
        PrismaService.connectionCount > PrismaService.MAX_CONNECTIONS * 0.8
          ? 'warning'
          : PrismaService.connectionCount > PrismaService.MAX_CONNECTIONS * 0.9
            ? 'critical'
            : 'healthy';

      return {
        connected: true,
        connectionCount: PrismaService.connectionCount,
        maxConnections: PrismaService.MAX_CONNECTIONS,
        health,
      };
    } catch (_error) {
      return {
        connected: false,
        connectionCount: PrismaService.connectionCount,
        maxConnections: PrismaService.MAX_CONNECTIONS,
        health: 'critical',
      };
    }
  }

  /**
   * Type-safe RBAC operations
   * These methods provide better type safety for RBAC operations
   */

  /**
   * Type-safe permission operations
   */
  async createPermissionSafe(data: {
    name: string;
    resource: string;
    action: string;
    description?: string | null;
    isSystemPermission?: boolean;
    isActive?: boolean;
  }): Promise<PermissionEntity> {
    type PermissionDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<PermissionEntity>;
    };
    const delegate = (this as unknown as { permission: PermissionDelegate })['permission'];
    return await delegate.create({
      data: {
        ...data,
        domain: 'healthcare',
      },
    } as PrismaDelegateArgs);
  }

  async findPermissionByIdSafe(id: string): Promise<PermissionEntity | null> {
    type PermissionDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<PermissionEntity | null>;
    };
    const delegate = (this as unknown as { permission: PermissionDelegate })['permission'];
    return await delegate.findUnique({
      where: { id },
    } as PrismaDelegateArgs);
  }

  async findPermissionByResourceActionSafe(
    resource: string,
    action: string
  ): Promise<PermissionEntity | null> {
    type PermissionDelegate = {
      findFirst: (args: PrismaDelegateArgs) => Promise<PermissionEntity | null>;
    };
    const delegate = (this as unknown as { permission: PermissionDelegate })['permission'];
    return await delegate.findFirst({
      where: { resource, action, domain: 'healthcare' },
    } as PrismaDelegateArgs);
  }

  async findPermissionsByResourceSafe(resource: string): Promise<PermissionEntity[]> {
    type PermissionDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<PermissionEntity[]>;
    };
    const delegate = (this as unknown as { permission: PermissionDelegate })['permission'];
    return await delegate.findMany({
      where: { resource, domain: 'healthcare', isActive: true },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    } as PrismaDelegateArgs);
  }

  async updatePermissionSafe(
    id: string,
    data: Partial<Pick<PermissionEntity, 'name' | 'description' | 'isActive'>> & { updatedAt: Date }
  ): Promise<PermissionEntity> {
    type PermissionDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<PermissionEntity>;
    };
    const delegate = (this as unknown as { permission: PermissionDelegate })['permission'];
    return await delegate.update({
      where: { id },
      data,
    } as PrismaDelegateArgs);
  }

  async countRolePermissionsSafe(permissionId: string): Promise<number> {
    type RolePermissionDelegate = {
      count: (args: PrismaDelegateArgs) => Promise<number>;
    };
    const delegate = (this as unknown as { rolePermission: RolePermissionDelegate })[
      'rolePermission'
    ];
    return await delegate.count({
      where: { permissionId, isActive: true },
    } as PrismaDelegateArgs);
  }

  async findSystemPermissionsSafe(): Promise<PermissionEntity[]> {
    type PermissionDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<PermissionEntity[]>;
    };
    const delegate = (this as unknown as { permission: PermissionDelegate })['permission'];
    return await delegate.findMany({
      where: { isSystemPermission: true, isActive: true },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    } as PrismaDelegateArgs);
  }

  /**
   * Type-safe role operations
   */
  async findRoleByNameSafe(name: string, clinicId?: string): Promise<RbacRoleEntity | null> {
    type RbacRoleDelegate = {
      findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { rbacRole: RbacRoleDelegate })['rbacRole'];
    const result = await delegate.findFirst({
      where: { name, domain: 'healthcare', clinicId },
    } as PrismaDelegateArgs);
    return result as RbacRoleEntity | null;
  }

  async createRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string | null;
    clinicId?: string | null;
    isSystemRole?: boolean;
    isActive?: boolean;
  }): Promise<RbacRoleEntity> {
    type RbacRoleDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { rbacRole: RbacRoleDelegate })['rbacRole'];
    const result = await delegate.create({
      data: {
        ...data,
        domain: 'healthcare',
      },
    } as PrismaDelegateArgs);
    return result as RbacRoleEntity;
  }

  async findRoleByIdSafe(id: string): Promise<RbacRoleEntity | null> {
    type RbacRoleDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { rbacRole: RbacRoleDelegate })['rbacRole'];
    const result = await delegate.findUnique({ where: { id } } as PrismaDelegateArgs);
    return result as RbacRoleEntity | null;
  }

  async findRolesByClinicSafe(clinicId?: string): Promise<RbacRoleEntity[]> {
    type RbacRoleDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { rbacRole: RbacRoleDelegate })['rbacRole'];
    const result = await delegate.findMany({
      where: { domain: 'healthcare', clinicId, isActive: true },
      orderBy: [{ name: 'asc' }],
    } as PrismaDelegateArgs);
    return result as RbacRoleEntity[];
  }

  async updateRoleSafe(
    id: string,
    data: {
      displayName?: string;
      description?: string | null;
      isActive?: boolean;
      updatedAt: Date;
    }
  ): Promise<RbacRoleEntity> {
    type RbacRoleDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { rbacRole: RbacRoleDelegate })['rbacRole'];
    const result = await delegate.update({
      where: { id },
      data,
    } as PrismaDelegateArgs);
    return result as RbacRoleEntity;
  }

  async countUserRolesSafe(roleId: string): Promise<number> {
    type UserRoleDelegate = {
      count: (args: PrismaDelegateArgs) => Promise<number>;
    };
    const delegate = (this as unknown as { userRole: UserRoleDelegate })['userRole'];
    return await delegate.count({
      where: { roleId, isActive: true },
    } as PrismaDelegateArgs);
  }

  async deleteRolePermissionsSafe(roleId: string): Promise<{ count: number }> {
    type RolePermissionDelegate = {
      deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
    };
    const delegate = (this as unknown as { rolePermission: RolePermissionDelegate })[
      'rolePermission'
    ];
    return await delegate.deleteMany({
      where: { roleId },
    } as PrismaDelegateArgs);
  }

  async createRolePermissionsSafe(
    permissions: Array<{ roleId: string; permissionId: string }>
  ): Promise<{ count: number }> {
    type RolePermissionDelegate = {
      createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
    };
    const delegate = (this as unknown as { rolePermission: RolePermissionDelegate })[
      'rolePermission'
    ];
    return await delegate.createMany({
      data: permissions.map(p => ({
        ...p,
        isActive: true,
        assignedAt: new Date(),
      })),
    } as PrismaDelegateArgs);
  }

  async removeRolePermissionsSafe(
    roleId: string,
    permissionIds: string[]
  ): Promise<{ count: number }> {
    type RolePermissionDelegate = {
      deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
    };
    const delegate = (this as unknown as { rolePermission: RolePermissionDelegate })[
      'rolePermission'
    ];
    return await delegate.deleteMany({
      where: { roleId, permissionId: { in: permissionIds } },
    } as PrismaDelegateArgs);
  }

  async findSystemRolesSafe(): Promise<RbacRoleEntity[]> {
    type RbacRoleResult = {
      id: string;
      name: string;
      displayName: string;
      description: string | null;
      domain: string;
      clinicId: string | null;
      isSystemRole: boolean;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    };
    type RbacRoleDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<RbacRoleResult[]>;
    };
    const delegate = (this as unknown as { rbacRole: RbacRoleDelegate })['rbacRole'];
    const result = await delegate.findMany({
      where: { isSystemRole: true, isActive: true },
      orderBy: [{ name: 'asc' }],
    } as PrismaDelegateArgs);
    return result as RbacRoleEntity[];
  }

  async createSystemRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string | null;
    clinicId?: string | null;
    isSystemRole?: boolean;
    isActive?: boolean;
  }): Promise<RbacRoleEntity> {
    type RbacRoleDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { rbacRole: RbacRoleDelegate })['rbacRole'];
    const result = await delegate.create({
      data: {
        ...data,
        domain: 'healthcare',
        isSystemRole: true,
      },
    } as PrismaDelegateArgs);
    return result as RbacRoleEntity;
  }

  /**
   * Type-safe user role operations
   */
  async findUserRoleAssignmentSafe(
    userId: string,
    roleId: string,
    clinicId?: string
  ): Promise<UserRoleEntity | null> {
    type UserRoleDelegate = {
      findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { userRole: UserRoleDelegate })['userRole'];
    const result = await delegate.findFirst({
      where: { userId, roleId, clinicId, isActive: true },
    } as PrismaDelegateArgs);
    return result as UserRoleEntity | null;
  }

  async createUserRoleSafe(data: {
    userId: string;
    roleId: string;
    clinicId?: string | null;
    assignedBy?: string;
    expiresAt?: Date | null;
    isActive?: boolean;
    isPrimary?: boolean;
    permissions?: Record<string, never>;
    schedule?: Record<string, never>;
  }): Promise<UserRoleEntity> {
    type UserRoleDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { userRole: UserRoleDelegate })['userRole'];
    const result = await delegate.create({ data } as PrismaDelegateArgs);
    return result as UserRoleEntity;
  }

  async findUserRoleForRevocationSafe(
    userId: string,
    roleId: string,
    clinicId?: string
  ): Promise<UserRoleEntity | null> {
    type UserRoleDelegate = {
      findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { userRole: UserRoleDelegate })['userRole'];
    const result = await delegate.findFirst({
      where: { userId, roleId, clinicId },
    } as PrismaDelegateArgs);
    return result as UserRoleEntity | null;
  }

  async updateUserRoleSafe(
    id: string,
    data: {
      isActive?: boolean;
      revokedAt?: Date | null;
      revokedBy?: string | null;
      expiresAt?: Date | null;
      updatedAt: Date;
    }
  ): Promise<UserRoleEntity> {
    type UserRoleDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { userRole: UserRoleDelegate })['userRole'];
    const result = await delegate.update({
      where: { id },
      data,
    } as PrismaDelegateArgs);
    return result as UserRoleEntity;
  }

  async findUserRolesSafe(userId: string, clinicId?: string): Promise<UserRoleEntity[]> {
    type UserRoleDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { userRole: UserRoleDelegate })['userRole'];
    const result = await delegate.findMany({
      where: { userId, clinicId, isActive: true },
      include: { role: { select: { name: true } } },
    } as PrismaDelegateArgs);
    return result as UserRoleEntity[];
  }

  async findRolePermissionsSafe(
    roleIds: string[]
  ): Promise<
    Array<RolePermissionEntity & { permission: Pick<PermissionEntity, 'resource' | 'action'> }>
  > {
    type RolePermissionDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { rolePermission: RolePermissionDelegate })[
      'rolePermission'
    ];
    const result = await delegate.findMany({
      where: { roleId: { in: roleIds }, isActive: true },
      include: {
        permission: { select: { resource: true, action: true } },
      },
    } as PrismaDelegateArgs);
    return result as Array<
      RolePermissionEntity & { permission: Pick<PermissionEntity, 'resource' | 'action'> }
    >;
  }

  /**
   * Comprehensive type-safe user operations
   */
  async findUserByIdSafe(id: string): Promise<UserFindUniqueResult> {
    type UserDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<UserWithRelations | null>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    return await userDelegate.findUnique({
      where: { id },
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
  }

  async findUserByEmailSafe(email: string): Promise<UserFindUniqueResult> {
    type UserDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<UserWithRelations | null>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    return await userDelegate.findUnique({
      where: { email },
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
  }

  async findUsersSafe(where: UserWhereInput): Promise<UserFindManyResult> {
    type UserDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<UserWithRelations[]>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    return await userDelegate.findMany({
      where,
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
  }

  async createUserSafe(data: UserCreateInput): Promise<UserWithRelations> {
    type UserDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<UserWithRelations>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    return await userDelegate.create({
      data,
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
  }

  async updateUserSafe(id: string, data: UserUpdateInput): Promise<UserWithRelations> {
    type UserDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<UserWithRelations>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    return await userDelegate.update({
      where: { id },
      data,
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
  }

  async deleteUserSafe(id: string): Promise<UserWithRelations> {
    type UserDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<UserWithRelations>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    return await userDelegate.delete({
      where: { id },
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
  }

  /**
   * Comprehensive type-safe appointment operations
   */
  async findAppointmentByIdSafe(id: string): Promise<AppointmentWithRelations | null> {
    type AppointmentDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const appointmentDelegate = (
      this as unknown as {
        appointment: AppointmentDelegate;
      }
    )['appointment'];
    const result = await appointmentDelegate.findUnique({
      where: { id },
      include: appointmentIncludeValidator,
    } as PrismaDelegateArgs);
    return result as AppointmentWithRelations | null;
  }

  async findAppointmentsSafe(where: AppointmentWhereInput): Promise<AppointmentWithRelations[]> {
    type AppointmentDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const appointmentDelegate = (
      this as unknown as {
        appointment: AppointmentDelegate;
      }
    )['appointment'];
    const result = await appointmentDelegate.findMany({
      where,
      include: appointmentIncludeValidator,
    } as PrismaDelegateArgs);
    return result as AppointmentWithRelations[];
  }

  async createAppointmentSafe(data: AppointmentCreateInput): Promise<AppointmentWithRelations> {
    type AppointmentDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const appointmentDelegate = (
      this as unknown as {
        appointment: AppointmentDelegate;
      }
    )['appointment'];
    const result = await appointmentDelegate.create({
      data,
      include: appointmentIncludeValidator,
    } as PrismaDelegateArgs);
    return result as AppointmentWithRelations;
  }

  async updateAppointmentSafe(
    id: string,
    data: AppointmentUpdateInput
  ): Promise<AppointmentWithRelations> {
    type AppointmentDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const appointmentDelegate = (
      this as unknown as {
        appointment: AppointmentDelegate;
      }
    )['appointment'];
    const result = await appointmentDelegate.update({
      where: { id },
      data,
      include: appointmentIncludeValidator,
    } as PrismaDelegateArgs);
    return result as AppointmentWithRelations;
  }

  async deleteAppointmentSafe(id: string): Promise<AppointmentWithRelations> {
    type AppointmentDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const appointmentDelegate = (
      this as unknown as {
        appointment: AppointmentDelegate;
      }
    )['appointment'];
    const result = await appointmentDelegate.delete({
      where: { id },
      include: appointmentIncludeValidator,
    } as PrismaDelegateArgs);
    return result as AppointmentWithRelations;
  }

  /**
   * Type-safe appointment time slots
   */
  async findAppointmentTimeSlotsSafe(
    doctorId: string,
    clinicId: string,
    date: Date
  ): Promise<AppointmentTimeSlotResult> {
    type AppointmentDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const appointmentDelegate = (
      this as unknown as {
        appointment: AppointmentDelegate;
      }
    )['appointment'];
    const result = await appointmentDelegate.findMany({
      where: {
        doctorId,
        clinicId,
        date: date,
        status: {
          in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'],
        },
      },
      select: appointmentTimeSlotSelectValidator,
    } as PrismaDelegateArgs);
    return result as AppointmentTimeSlot[];
  }

  /**
   * Type-safe count operations
   */
  async countUsersSafe(where: UserWhereInput): Promise<number> {
    type UserDelegate = {
      count: (args: PrismaDelegateArgs) => Promise<number>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    return await userDelegate.count({ where } as PrismaDelegateArgs);
  }

  async countAppointmentsSafe(where: AppointmentWhereInput): Promise<number> {
    type AppointmentDelegate = {
      count: (args: PrismaDelegateArgs) => Promise<number>;
    };
    const appointmentDelegate = (
      this as unknown as {
        appointment: AppointmentDelegate;
      }
    )['appointment'];
    return await appointmentDelegate.count({ where } as PrismaDelegateArgs);
  }

  // Billing-related type-safe methods
  async findBillingPlanByIdSafe(id: string): Promise<BillingPlanWithRelations | null> {
    type BillingPlanDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { billingPlan: BillingPlanDelegate })['billingPlan'];
    const result = await delegate.findUnique({
      where: { id },
      include: { subscriptions: true },
    } as PrismaDelegateArgs);
    return result as BillingPlanWithRelations | null;
  }

  async findBillingPlansSafe(where: BillingPlanWhereInput): Promise<BillingPlanWithRelations[]> {
    type BillingPlanDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { billingPlan: BillingPlanDelegate })['billingPlan'];
    const result = await delegate.findMany({
      where,
      include: { subscriptions: true },
    } as PrismaDelegateArgs);
    return result as BillingPlanWithRelations[];
  }

  async createBillingPlanSafe(data: BillingPlanCreateInput): Promise<BillingPlanWithRelations> {
    type BillingPlanDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { billingPlan: BillingPlanDelegate })['billingPlan'];
    const result = await delegate.create({
      data,
      include: { subscriptions: true },
    } as PrismaDelegateArgs);
    return result as BillingPlanWithRelations;
  }

  async updateBillingPlanSafe(
    id: string,
    data: BillingPlanUpdateInput
  ): Promise<BillingPlanWithRelations> {
    type BillingPlanDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { billingPlan: BillingPlanDelegate })['billingPlan'];
    const result = await delegate.update({
      where: { id },
      data,
      include: { subscriptions: true },
    } as PrismaDelegateArgs);
    return result as BillingPlanWithRelations;
  }

  async findSubscriptionByIdSafe(id: string): Promise<SubscriptionWithRelations | null> {
    type SubscriptionDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { subscription: SubscriptionDelegate })['subscription'];
    const result = await delegate.findUnique({
      where: { id },
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    } as PrismaDelegateArgs);
    return result as SubscriptionWithRelations | null;
  }

  async findSubscriptionsSafe(where: SubscriptionWhereInput): Promise<SubscriptionWithRelations[]> {
    type SubscriptionDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { subscription: SubscriptionDelegate })['subscription'];
    const result = await delegate.findMany({
      where,
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    } as PrismaDelegateArgs);
    return result as SubscriptionWithRelations[];
  }

  async createSubscriptionSafe(data: SubscriptionCreateInput): Promise<SubscriptionWithRelations> {
    type SubscriptionDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { subscription: SubscriptionDelegate })['subscription'];
    const result = await delegate.create({
      data,
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    } as PrismaDelegateArgs);
    return result as SubscriptionWithRelations;
  }

  async updateSubscriptionSafe(
    id: string,
    data: SubscriptionUpdateInput
  ): Promise<SubscriptionWithRelations> {
    type SubscriptionDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { subscription: SubscriptionDelegate })['subscription'];
    const result = await delegate.update({
      where: { id },
      data,
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    } as PrismaDelegateArgs);
    return result as SubscriptionWithRelations;
  }

  async findInvoiceByIdSafe(id: string): Promise<InvoiceWithRelations | null> {
    type InvoiceDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { invoice: InvoiceDelegate })['invoice'];
    const result = await delegate.findUnique({
      where: { id },
      include: {
        subscription: true,
        payments: true,
      },
    } as PrismaDelegateArgs);
    return result as InvoiceWithRelations | null;
  }

  async findInvoicesSafe(where: InvoiceWhereInput): Promise<InvoiceWithRelations[]> {
    type InvoiceDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { invoice: InvoiceDelegate })['invoice'];
    const result = await delegate.findMany({
      where,
      include: {
        subscription: true,
        payments: true,
      },
    } as PrismaDelegateArgs);
    return result as InvoiceWithRelations[];
  }

  async createInvoiceSafe(data: InvoiceCreateInput): Promise<InvoiceWithRelations> {
    type InvoiceDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { invoice: InvoiceDelegate })['invoice'];
    const result = await delegate.create({
      data,
      include: {
        subscription: true,
        payments: true,
      },
    } as PrismaDelegateArgs);
    return result as InvoiceWithRelations;
  }

  async updateInvoiceSafe(id: string, data: InvoiceUpdateInput): Promise<InvoiceWithRelations> {
    type InvoiceDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { invoice: InvoiceDelegate })['invoice'];
    const result = await delegate.update({
      where: { id },
      data,
      include: {
        subscription: true,
        payments: true,
      },
    } as PrismaDelegateArgs);
    return result as InvoiceWithRelations;
  }

  async findPaymentByIdSafe(id: string): Promise<PaymentWithRelations | null> {
    type PaymentDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { payment: PaymentDelegate })['payment'];
    const result = await delegate.findUnique({
      where: { id },
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    } as PrismaDelegateArgs);
    return result as PaymentWithRelations | null;
  }

  async findPaymentsSafe(where: PaymentWhereInput): Promise<PaymentWithRelations[]> {
    type PaymentDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { payment: PaymentDelegate })['payment'];
    const result = await delegate.findMany({
      where,
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    } as PrismaDelegateArgs);
    return result as PaymentWithRelations[];
  }

  async createPaymentSafe(data: PaymentCreateInput): Promise<PaymentWithRelations> {
    type PaymentDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { payment: PaymentDelegate })['payment'];
    const result = await delegate.create({
      data,
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    } as PrismaDelegateArgs);
    return result as PaymentWithRelations;
  }

  async updatePaymentSafe(id: string, data: PaymentUpdateInput): Promise<PaymentWithRelations> {
    type PaymentDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { payment: PaymentDelegate })['payment'];
    const result = await delegate.update({
      where: { id },
      data,
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    } as PrismaDelegateArgs);
    return result as PaymentWithRelations;
  }

  // Delete methods
  async deleteBillingPlanSafe(id: string): Promise<BillingPlanWithRelations> {
    type BillingPlanDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<BillingPlanWithRelations>;
    };
    const delegate = (this as unknown as { billingPlan: BillingPlanDelegate })['billingPlan'];
    return await delegate.delete({
      where: { id },
      include: { subscriptions: true },
    } as PrismaDelegateArgs);
  }

  async deleteSubscriptionSafe(id: string): Promise<SubscriptionWithRelations> {
    type SubscriptionDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<SubscriptionWithRelations>;
    };
    const delegate = (this as unknown as { subscription: SubscriptionDelegate })['subscription'];
    return await delegate.delete({
      where: { id },
      include: {
        plan: true,
        payments: true,
        invoices: true,
        appointments: true,
      },
    } as PrismaDelegateArgs);
  }

  async deleteInvoiceSafe(id: string): Promise<InvoiceWithRelations> {
    type InvoiceDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<InvoiceWithRelations>;
    };
    const delegate = (this as unknown as { invoice: InvoiceDelegate })['invoice'];
    return await delegate.delete({
      where: { id },
      include: {
        subscription: true,
        payments: true,
      },
    } as PrismaDelegateArgs);
  }

  async deletePaymentSafe(id: string): Promise<PaymentWithRelations> {
    type PaymentDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<PaymentWithRelations>;
    };
    const delegate = (this as unknown as { payment: PaymentDelegate })['payment'];
    return await delegate.delete({
      where: { id },
      include: {
        appointment: true,
        invoice: true,
        subscription: true,
      },
    } as PrismaDelegateArgs);
  }

  // Clinic methods
  async findClinicByIdSafe(id: string): Promise<{
    name: string;
    address?: string;
    phone?: string;
    email?: string;
  } | null> {
    type ClinicDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { clinic: ClinicDelegate })['clinic'];
    const result = await delegate.findUnique({ where: { id } } as PrismaDelegateArgs);
    return result as {
      name: string;
      address?: string;
      phone?: string;
      email?: string;
    } | null;
  }

  async deleteClinicSafe(id: string): Promise<{ id: string; name: string }> {
    type ClinicDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { clinic: ClinicDelegate })['clinic'];
    const result = await delegate.delete({ where: { id } } as PrismaDelegateArgs);
    return result as { id: string; name: string };
  }

  // Clinic Admin methods
  async createClinicAdminSafe(data: {
    userId: string;
    clinicId: string;
  }): Promise<{ id: string; userId: string; clinicId: string }> {
    type ClinicAdminDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { clinicAdmin: ClinicAdminDelegate })['clinicAdmin'];
    const result = await delegate.create({ data } as PrismaDelegateArgs);
    return result as { id: string; userId: string; clinicId: string };
  }

  async findClinicAdminByIdSafe(id: string): Promise<{
    id: string;
    userId: string;
    clinicId: string;
    user?: { id: string; email: string; name: string; role: string };
  } | null> {
    type ClinicAdminDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { clinicAdmin: ClinicAdminDelegate })['clinicAdmin'];
    const result = await delegate.findUnique({
      where: { id },
      include: { user: true },
    } as PrismaDelegateArgs);
    return result as {
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string };
    } | null;
  }

  async findClinicAdminsSafe(where: { clinicId?: string; userId?: string }): Promise<
    Array<{
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string } | undefined;
    }>
  > {
    type ClinicAdminDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { clinicAdmin: ClinicAdminDelegate })['clinicAdmin'];
    const result = await delegate.findMany({
      where,
      include: { user: true },
    } as PrismaDelegateArgs);
    return result as Array<{
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string } | undefined;
    }>;
  }

  async deleteClinicAdminSafe(
    id: string
  ): Promise<{ id: string; userId: string; clinicId: string }> {
    type ClinicAdminDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const delegate = (this as unknown as { clinicAdmin: ClinicAdminDelegate })['clinicAdmin'];
    const result = await delegate.delete({ where: { id } } as PrismaDelegateArgs);
    return result as { id: string; userId: string; clinicId: string };
  }

  /**
   * Get type-safe Prisma client for operations
   */
  getTypedClient(): PrismaClient {
    return this as unknown as PrismaClient;
  }

  // Delegate properties are now initialized in constructor - no getters needed
  // Access delegates directly as properties: prismaService.user, prismaService.clinic, etc.

  /**
   * Type-safe raw query execution
   */
  async $queryRaw<T = Record<string, never>>(
    query: TemplateStringsArray | string,
    ...values: Array<string | number | boolean | null>
  ): Promise<T> {
    const prismaClient = this as unknown as {
      $queryRaw: (
        query: TemplateStringsArray | string,
        ...values: Array<string | number | boolean | null>
      ) => Promise<T>;
    };
    return await prismaClient.$queryRaw(query, ...values);
  }

  /**
   * Execute raw SQL query with unsafe parameters (for dynamic queries)
   */
  async $queryRawUnsafe<T = Record<string, never>>(
    query: string,
    ...values: Array<string | number | boolean | null>
  ): Promise<T> {
    const prismaClient = this.prismaClient as unknown as {
      $queryRawUnsafe: (
        query: string,
        ...values: Array<string | number | boolean | null>
      ) => Promise<T>;
    };
    return await prismaClient.$queryRawUnsafe(query, ...values);
  }

  // $transaction is now a readonly property initialized in constructor

  /**
   * Comprehensive type-safe operations for all entities
   * These replace the functionality from TypedPrismaOperations
   */
  async findUsersWithRole(role?: string): Promise<UserWithRelations[]> {
    type UserDelegate = {
      findMany: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    const result = await userDelegate.findMany({
      where: role ? { role } : undefined,
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
    return result as UserWithRelations[];
  }

  async findUserById(id: string): Promise<UserWithRelations | null> {
    type UserDelegate = {
      findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    const result = await userDelegate.findUnique({
      where: { id },
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
    return result as UserWithRelations | null;
  }

  async findUserByEmail(email: string): Promise<UserWithRelations | null> {
    type UserDelegate = {
      findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    const result = await userDelegate.findFirst({
      where: { email },
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
    return result as UserWithRelations | null;
  }

  async countUsers(): Promise<number> {
    type UserDelegate = {
      count: (args?: PrismaDelegateArgs) => Promise<unknown>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    const result = await userDelegate.count();
    return result as number;
  }

  async createUser(data: UserCreateInput): Promise<UserWithRelations> {
    type UserDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    const result = await userDelegate.create({
      data,
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
    return result as UserWithRelations;
  }

  async updateUser(id: string, data: UserUpdateInput): Promise<UserWithRelations> {
    type UserDelegate = {
      update: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    const result = await userDelegate.update({
      where: { id },
      data,
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
    return result as UserWithRelations;
  }

  async deleteUser(id: string): Promise<UserWithRelations> {
    type UserDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const userDelegate = (this as unknown as { user: UserDelegate })['user'];
    const result = await userDelegate.delete({
      where: { id },
      include: userIncludeValidator,
    } as PrismaDelegateArgs);
    return result as UserWithRelations;
  }

  /**
   * Type-safe entity creation methods
   */
  async createDoctor(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<Doctor> {
    type DoctorDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const doctorDelegate = (this as unknown as { doctor: DoctorDelegate })['doctor'];
    const result = await doctorDelegate.create({ data } as PrismaDelegateArgs);
    return result as Doctor;
  }

  async createPatient(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<Patient> {
    type PatientDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const patientDelegate = (this as unknown as { patient: PatientDelegate })['patient'];
    const result = await patientDelegate.create({ data } as PrismaDelegateArgs);
    return result as Patient;
  }

  async createReceptionist(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<Receptionist> {
    type ReceptionistDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const receptionistDelegate = (
      this as unknown as {
        receptionist: ReceptionistDelegate;
      }
    )['receptionist'];
    const result = await receptionistDelegate.create({ data } as PrismaDelegateArgs);
    return result as Receptionist;
  }

  async createClinicAdmin(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<ClinicAdmin> {
    type ClinicAdminDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const clinicAdminDelegate = (
      this as unknown as {
        clinicAdmin: ClinicAdminDelegate;
      }
    )['clinicAdmin'];
    const result = await clinicAdminDelegate.create({ data } as PrismaDelegateArgs);
    return result as ClinicAdmin;
  }

  async createSuperAdmin(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<SuperAdmin> {
    type SuperAdminDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const superAdminDelegate = (
      this as unknown as {
        superAdmin: SuperAdminDelegate;
      }
    )['superAdmin'];
    const result = await superAdminDelegate.create({ data } as PrismaDelegateArgs);
    return result as SuperAdmin;
  }

  async createPharmacist(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<Pharmacist> {
    type PharmacistDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const pharmacistDelegate = (
      this as unknown as {
        pharmacist: PharmacistDelegate;
      }
    )['pharmacist'];
    const result = await pharmacistDelegate.create({ data } as PrismaDelegateArgs);
    return result as Pharmacist;
  }

  async createTherapist(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<Therapist> {
    type TherapistDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const therapistDelegate = (
      this as unknown as {
        therapist: TherapistDelegate;
      }
    )['therapist'];
    const result = await therapistDelegate.create({ data } as PrismaDelegateArgs);
    return result as Therapist;
  }

  async createLabTechnician(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<LabTechnician> {
    type LabTechnicianDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const labTechnicianDelegate = (
      this as unknown as {
        labTechnician: LabTechnicianDelegate;
      }
    )['labTechnician'];
    const result = await labTechnicianDelegate.create({ data } as PrismaDelegateArgs);
    return result as LabTechnician;
  }

  async createFinanceBilling(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<FinanceBilling> {
    type FinanceBillingDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const financeBillingDelegate = (
      this as unknown as {
        financeBilling: FinanceBillingDelegate;
      }
    )['financeBilling'];
    const result = await financeBillingDelegate.create({ data } as PrismaDelegateArgs);
    return result as FinanceBilling;
  }

  async createSupportStaff(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<SupportStaff> {
    type SupportStaffDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const supportStaffDelegate = (
      this as unknown as {
        supportStaff: SupportStaffDelegate;
      }
    )['supportStaff'];
    const result = await supportStaffDelegate.create({ data } as PrismaDelegateArgs);
    return result as SupportStaff;
  }

  async createNurse(data: Record<string, string | number | boolean | Date | null>): Promise<Nurse> {
    type NurseDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const nurseDelegate = (this as unknown as { nurse: NurseDelegate })['nurse'];
    const result = await nurseDelegate.create({ data } as PrismaDelegateArgs);
    return result as Nurse;
  }

  async createCounselor(
    data: Record<string, string | number | boolean | Date | null>
  ): Promise<Counselor> {
    type CounselorDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const counselorDelegate = (
      this as unknown as {
        counselor: CounselorDelegate;
      }
    )['counselor'];
    const result = await counselorDelegate.create({ data } as PrismaDelegateArgs);
    return result as Counselor;
  }

  /**
   * Type-safe entity deletion methods
   */
  async deleteDoctor(userId: string): Promise<Doctor> {
    type DoctorDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const doctorDelegate = (this as unknown as { doctor: DoctorDelegate })['doctor'];
    const result = await doctorDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as Doctor;
  }

  async deletePatient(userId: string): Promise<Patient> {
    type PatientDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const patientDelegate = (this as unknown as { patient: PatientDelegate })['patient'];
    const result = await patientDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as Patient;
  }

  async deleteReceptionist(userId: string): Promise<Receptionist> {
    type ReceptionistDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const receptionistDelegate = (
      this as unknown as {
        receptionist: ReceptionistDelegate;
      }
    )['receptionist'];
    const result = await receptionistDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as Receptionist;
  }

  async deleteClinicAdmin(userId: string): Promise<ClinicAdmin> {
    type ClinicAdminDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const clinicAdminDelegate = (
      this as unknown as {
        clinicAdmin: ClinicAdminDelegate;
      }
    )['clinicAdmin'];
    const result = await clinicAdminDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as ClinicAdmin;
  }

  async deleteSuperAdmin(userId: string): Promise<SuperAdmin> {
    type SuperAdminDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const superAdminDelegate = (
      this as unknown as {
        superAdmin: SuperAdminDelegate;
      }
    )['superAdmin'];
    const result = await superAdminDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as SuperAdmin;
  }

  async deletePharmacist(userId: string): Promise<Pharmacist> {
    type PharmacistDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const pharmacistDelegate = (
      this as unknown as {
        pharmacist: PharmacistDelegate;
      }
    )['pharmacist'];
    const result = await pharmacistDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as Pharmacist;
  }

  async deleteTherapist(userId: string): Promise<Therapist> {
    type TherapistDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const therapistDelegate = (
      this as unknown as {
        therapist: TherapistDelegate;
      }
    )['therapist'];
    const result = await therapistDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as Therapist;
  }

  async deleteLabTechnician(userId: string): Promise<LabTechnician> {
    type LabTechnicianDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const labTechnicianDelegate = (
      this as unknown as {
        labTechnician: LabTechnicianDelegate;
      }
    )['labTechnician'];
    const result = await labTechnicianDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as LabTechnician;
  }

  async deleteFinanceBilling(userId: string): Promise<FinanceBilling> {
    type FinanceBillingDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const financeBillingDelegate = (
      this as unknown as {
        financeBilling: FinanceBillingDelegate;
      }
    )['financeBilling'];
    const result = await financeBillingDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as FinanceBilling;
  }

  async deleteSupportStaff(userId: string): Promise<SupportStaff> {
    type SupportStaffDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const supportStaffDelegate = (
      this as unknown as {
        supportStaff: SupportStaffDelegate;
      }
    )['supportStaff'];
    const result = await supportStaffDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as SupportStaff;
  }

  async deleteNurse(userId: string): Promise<Nurse> {
    type NurseDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const nurseDelegate = (this as unknown as { nurse: NurseDelegate })['nurse'];
    const result = await nurseDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as Nurse;
  }

  async deleteCounselor(userId: string): Promise<Counselor> {
    type CounselorDelegate = {
      delete: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const counselorDelegate = (
      this as unknown as {
        counselor: CounselorDelegate;
      }
    )['counselor'];
    const result = await counselorDelegate.delete({ where: { userId } } as PrismaDelegateArgs);
    return result as Counselor;
  }

  /**
   * Type-safe clinic and audit operations
   */
  async findClinics(): Promise<Clinic[]> {
    type ClinicDelegate = {
      findMany: () => Promise<unknown>;
    };
    const clinicDelegate = (this as unknown as { clinic: ClinicDelegate })['clinic'];
    const result = await clinicDelegate.findMany();
    return result as Clinic[];
  }

  async createAuditLog(data: {
    userId: string;
    action: string;
    timestamp?: Date;
    ipAddress?: string | null;
    device?: string | null;
    description?: string;
    clinicId?: string | null;
  }): Promise<AuditLog> {
    type AuditLogDelegate = {
      create: (args: PrismaDelegateArgs) => Promise<unknown>;
    };
    const auditLogDelegate = (this as unknown as { auditLog: AuditLogDelegate })['auditLog'];
    const result = await auditLogDelegate.create({ data } as PrismaDelegateArgs);
    return result as AuditLog;
  }
}
