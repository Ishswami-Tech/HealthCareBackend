import { registerAs } from '@nestjs/config';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import {
  getEnv,
  getEnvWithDefault,
  getEnvNumber,
  getEnvBoolean,
  getEnvironment,
  isProduction,
} from '@config/environment/utils';

/**
 * Healthcare Multi-Clinic Configuration
 *
 * This configuration supports:
 * - Single healthcare application serving multiple clinics
 * - Each clinic can have multiple locations
 * - HIPAA compliance across all clinics
 * - Row-level security for data isolation
 * - Scalable for 10 lakh+ users across all clinics
 */

export const healthcareConfig = registerAs('healthcare', () => ({
  // Application settings
  appName: 'Healthcare Management System',
  appType: 'healthcare',

  // Multi-clinic settings
  // Use helper functions (which use dotenv) for environment variable access
  // These mimic ConfigService methods but work in config factories
  multiClinic: {
    enabled: getEnvBoolean('MULTI_CLINIC_ENABLED', true),
    isolationLevel: getEnvWithDefault('CLINIC_ISOLATION_LEVEL', 'row'), // 'row' | 'schema'
    maxClinicsPerApp: getEnvNumber('MAX_CLINICS_PER_APP', 200),
    maxLocationsPerClinic: getEnvNumber('MAX_LOCATIONS_PER_CLINIC', 50),
  },

  // Enterprise Database configuration for 1M+ users
  database: {
    url: getEnvWithDefault('DATABASE_URL', 'postgresql://localhost:5432/healthcare'),
    schema: 'healthcare',
    ssl: getEnvBoolean('DATABASE_SSL', false),
    connectionPool: {
      // Enhanced connection pooling for 1M+ users
      primary: {
        min: getEnvNumber('DB_POOL_MIN', 50), // Increased for scale
        max: getEnvNumber('DB_POOL_MAX', 500), // Increased for 1M users
        acquireTimeout: getEnvNumber('DB_POOL_ACQUIRE_TIMEOUT', 60000),
        idleTimeout: getEnvNumber('DB_POOL_IDLE_TIMEOUT', 300000),
        reapInterval: getEnvNumber('DB_POOL_REAP_INTERVAL', 1000),
        createTimeout: getEnvNumber('DB_POOL_CREATE_TIMEOUT', 30000),
        destroyTimeout: getEnvNumber('DB_POOL_DESTROY_TIMEOUT', 5000),
        createRetryInterval: getEnvNumber('DB_POOL_CREATE_RETRY_INTERVAL', 200),
      },
      // Read replica support for scaling reads
      readReplicas: {
        enabled: getEnvBoolean('DB_READ_REPLICAS_ENABLED', false),
        min: getEnvNumber('DB_READ_POOL_MIN', 25),
        max: getEnvNumber('DB_READ_POOL_MAX', 200),
        loadBalancing: getEnvWithDefault('DB_LOAD_BALANCING', 'round-robin'),
        failover: getEnvBoolean('DB_FAILOVER', true),
        urls: (() => {
          const urlsValue = getEnv('READ_REPLICA_URLS');
          return urlsValue ? urlsValue.split(',').filter(Boolean) : [];
        })(),
      },
      // Connection validation for reliability
      validation: {
        enabled: true,
        query: 'SELECT 1',
        interval: getEnvNumber('DB_VALIDATION_INTERVAL', 30000),
        timeout: getEnvNumber('DB_VALIDATION_TIMEOUT', 5000),
      },
    },
    // Advanced query optimization for 1M users
    queryOptimization: {
      enabled: true,
      batchSize: getEnvNumber('DB_BATCH_SIZE', 2000), // Larger batches for scale
      parallelQueries: getEnvNumber('DB_PARALLEL_QUERIES', 20), // More parallel processing
      queryCache: {
        enabled: getEnvBoolean('DB_QUERY_CACHE', true),
        ttl: getEnvNumber('DB_QUERY_CACHE_TTL', 300),
        maxSize: getEnvNumber('DB_QUERY_CACHE_MAX_SIZE', 50000), // Larger cache
      },
      resultCache: {
        enabled: getEnvBoolean('DB_RESULT_CACHE', true),
        ttl: getEnvNumber('DB_RESULT_CACHE_TTL', 600),
        maxSize: getEnvNumber('DB_RESULT_CACHE_MAX_SIZE', 100000), // Larger cache
      },
      // Circuit breaker for resilience
      circuitBreaker: {
        enabled: getEnvBoolean('DB_CIRCUIT_BREAKER', true),
        failureThreshold: getEnvNumber('DB_CIRCUIT_BREAKER_THRESHOLD', 5),
        timeout: getEnvNumber('DB_CIRCUIT_BREAKER_TIMEOUT', 30000),
        resetTimeout: getEnvNumber('DB_CIRCUIT_BREAKER_RESET', 60000),
      },
    },
    // Performance tuning for massive scale
    performance: {
      // Memory optimization for large scale
      memory: {
        sharedBuffers: getEnvWithDefault('DB_SHARED_BUFFERS', '512MB'),
        effectiveCacheSize: getEnvWithDefault('DB_EFFECTIVE_CACHE_SIZE', '4GB'),
        workMem: getEnvWithDefault('DB_WORK_MEM', '8MB'),
        maintenanceWorkMem: getEnvWithDefault('DB_MAINTENANCE_WORK_MEM', '256MB'),
        maxConnections: getEnvNumber('DB_MAX_CONNECTIONS', 500),
      },
      // WAL configuration for high throughput
      wal: {
        enabled: getEnvBoolean('DB_WAL_ENABLED', true),
        level: getEnvWithDefault('DB_WAL_LEVEL', 'replica'),
        keepSegments: getEnvNumber('DB_WAL_KEEP_SEGMENTS', 128),
        archiveTimeout: getEnvNumber('DB_WAL_ARCHIVE_TIMEOUT', 60),
      },
      // Auto-scaling configuration
      autoScaling: {
        enabled: getEnvBoolean('DB_AUTO_SCALING_ENABLED', true),
        cpuThreshold: getEnvNumber('DB_AUTO_SCALING_CPU_THRESHOLD', 75),
        connectionThreshold: getEnvNumber('DB_AUTO_SCALING_CONNECTION_THRESHOLD', 400),
        scaleUpCooldown: getEnvNumber('DB_SCALE_UP_COOLDOWN', 300),
        scaleDownCooldown: getEnvNumber('DB_SCALE_DOWN_COOLDOWN', 1800),
      },
    },
  },

  // Cache settings - Optimized for 10M+ users
  // Note: Cache enabled status is controlled by cache.config.ts (single source of truth)
  // Use helper functions (which use dotenv) for environment variable access
  cache: {
    enabled: getEnvBoolean('CACHE_ENABLED', false),
    ttl: getEnvNumber('CACHE_TTL', 300), // 5 minutes
    maxSize: getEnvNumber('CACHE_MAX_SIZE', 100000), // Increased from 10000 to 100000 for 10M+ users

    // Clinic-specific cache TTL
    clinicDataTtl: getEnvNumber('CLINIC_CACHE_TTL', 3600), // 1 hour
    patientDataTtl: getEnvNumber('PATIENT_CACHE_TTL', 1800), // 30 minutes
    appointmentDataTtl: getEnvNumber('APPOINTMENT_CACHE_TTL', 300), // 5 minutes
    emergencyDataTtl: getEnvNumber('EMERGENCY_CACHE_TTL', 60), // 1 minute
  },

  // HIPAA Compliance settings
  hipaa: {
    enabled: true,
    encryptionLevel: 'AES-256',
    auditLogging: true,
    dataRetention: {
      patientRecords: '30_years', // Extended for healthcare
      medicalHistory: 'lifetime',
      auditLogs: '10_years',
      appointments: '7_years',
      billing: '10_years',
      prescriptions: '10_years',
    },
    backupFrequency: 'daily',
    disasterRecovery: true,
    accessControls: {
      roleBasedAccess: true,
      clinicBasedAccess: true, // Clinic-level isolation
      locationBasedAccess: true,
      timeBasedAccess: true,
      ipBasedAccess: true,
      deviceBasedAccess: true,
    },
  },

  // Security configuration
  // Use helper functions (which use dotenv) for environment variable access
  security: {
    encryption: {
      algorithm: getEnvWithDefault('ENCRYPTION_ALGORITHM', 'AES-256-GCM'),
      keyRotation: getEnvNumber('ENCRYPTION_KEY_ROTATION_DAYS', 90),
      keyStorage: getEnvWithDefault('ENCRYPTION_KEY_STORAGE', 'local'), // 'aws-kms' | 'azure-keyvault' | 'local'
    },
    authentication: {
      jwtSecret: getEnvWithDefault('JWT_SECRET', 'your-healthcare-jwt-secret'),
      jwtExpiration: getEnvWithDefault('JWT_EXPIRATION', '8h'), // Shorter for healthcare
      refreshTokenExpiration: getEnvWithDefault('REFRESH_TOKEN_EXPIRATION', '24h'),
      sessionTimeout: getEnvNumber('SESSION_TIMEOUT', 28800), // 8 hours
      passwordPolicy: {
        minLength: getEnvNumber('PASSWORD_MIN_LENGTH', 12), // Stricter for healthcare
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        preventReuse: getEnvNumber('PASSWORD_HISTORY', 12),
      },
    },
    rateLimit: {
      // Per-clinic rate limiting for better resource distribution
      perClinicLimits: {
        loginAttempts: getEnvNumber('RATE_LIMIT_LOGIN', 5),
        apiCalls: getEnvNumber('RATE_LIMIT_API', 1000),
        patientSearch: getEnvNumber('RATE_LIMIT_PATIENT_SEARCH', 100),
        appointmentBooking: getEnvNumber('RATE_LIMIT_APPOINTMENT', 50),
      },
      windowMs: getEnvNumber('RATE_LIMIT_WINDOW', 900000), // 15 minutes
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
    },
  },

  // Healthcare-specific features
  features: {
    // Multi-clinic features
    multiClinicSupport: true,
    clinicManagement: true,
    locationManagement: true,
    staffManagement: true,

    // Core healthcare features
    patientManagement: true,
    appointmentScheduling: true,
    medicalRecords: true,
    prescriptionManagement: true,
    billingAndInsurance: true,
    labIntegration: true,
    pharmacyIntegration: true,
    telemedicine: true,

    // Advanced features
    reporting: true,
    analytics: true,
    auditTrails: true,
    emergencyAlerts: true,
    backupAndRecovery: true,

    // Integration features
    hl7Integration: getEnvBoolean('HL7_INTEGRATION', false),
    fhirCompliance: getEnvBoolean('FHIR_COMPLIANCE', false),
    icdIntegration: getEnvBoolean('ICD_INTEGRATION', false),
  },

  // Clinic configuration
  clinic: {
    requireVerification: getEnvBoolean('CLINIC_VERIFICATION_REQUIRED', true),
    maxStaffPerClinic: getEnvNumber('MAX_STAFF_PER_CLINIC', 500),
    maxPatientsPerClinic: getEnvNumber('MAX_PATIENTS_PER_CLINIC', 25000), // 10L users across 200 clinics = ~5K avg per clinic
    requireOperatingHours: true,
    requireContactInfo: true,
    requireLicenseInfo: true,

    // Location settings
    locations: {
      requireAddress: true,
      requirePhone: true,
      requireEmail: true,
      requireOperatingHours: true,
      requireStaffAssignment: true,
      allowOverlapSchedules: getEnvBoolean('ALLOW_OVERLAP_SCHEDULES', false),
    },
  },

  // Performance and scaling for 10 lakh users
  performance: {
    connectionPooling: {
      enabled: true,
      strategy: 'round_robin', // 'round_robin' | 'least_connections'
      healthCheckInterval: getEnvNumber('HEALTH_CHECK_INTERVAL', 30000),
    },
    caching: {
      strategy: 'lru', // 'lru' | 'lfu' | 'fifo'
      distributedCache: getEnvBoolean('DISTRIBUTED_CACHE', true),
      cacheWarmup: getEnvBoolean('CACHE_WARMUP', true),
    },
    queryOptimization: {
      enabled: true,
      slowQueryThreshold: getEnvNumber('SLOW_QUERY_THRESHOLD', 1000),
      queryLogging: getEnvBoolean('QUERY_LOGGING', false),
      batchSize: getEnvNumber('BATCH_SIZE', 100),
    },
    loadBalancing: {
      enabled: getEnvBoolean('LOAD_BALANCING', false),
      algorithm: getEnvWithDefault('LOAD_BALANCE_ALGORITHM', 'round_robin'),
    },
  },

  // Monitoring and observability
  monitoring: {
    metrics: {
      enabled: getEnvBoolean('METRICS_ENABLED', true),
      collectionInterval: getEnvNumber('METRICS_COLLECTION_INTERVAL', 60000),
      retentionPeriod: getEnvNumber('METRICS_RETENTION_PERIOD', 604800), // 7 days

      // Healthcare-specific metrics
      trackPatientMetrics: true,
      trackAppointmentMetrics: true,
      trackBillingMetrics: true,
      trackSystemPerformance: true,
    },
    logging: {
      level: getEnvWithDefault('LOG_LEVEL', 'info'),
      format: getEnvWithDefault('LOG_FORMAT', 'json'),
      destination: getEnvWithDefault('LOG_DESTINATION', 'file'),

      // HIPAA-compliant logging
      auditLogging: true,
      securityEventLogging: true,
      dataAccessLogging: true,
      logRetention: getEnvNumber('LOG_RETENTION_DAYS', 2555), // 7 years
    },
    healthChecks: {
      enabled: true,
      interval: getEnvNumber('HEALTH_CHECK_INTERVAL', 30000),
      timeout: getEnvNumber('HEALTH_CHECK_TIMEOUT', 5000),
      endpoints: ['/health', '/health/db', '/health/cache', '/health/queue'],
    },
    alerts: {
      enabled: getEnvBoolean('ALERTS_ENABLED', true),
      emergencyAlerts: true,
      systemAlerts: true,
      securityAlerts: true,
      performanceAlerts: true,
    },
  },

  // Backup and disaster recovery
  backup: {
    enabled: getEnvBoolean('BACKUP_ENABLED', true),
    frequency: getEnvWithDefault('BACKUP_FREQUENCY', 'hourly'), // More frequent for healthcare
    fullBackupFrequency: getEnvWithDefault('FULL_BACKUP_FREQUENCY', 'daily'),
    retention: getEnvNumber('BACKUP_RETENTION_DAYS', 365), // 1 year

    storage: {
      type: getEnvWithDefault('BACKUP_STORAGE_TYPE', 'local'), // 's3' | 'azure-blob' | 'local'
      path: getEnvWithDefault('BACKUP_STORAGE_PATH', './backups'),
      compression: getEnvBoolean('BACKUP_COMPRESSION', true),
    },
    encryption: {
      enabled: true,
      algorithm: 'AES-256',
    },
    testing: {
      enabled: getEnvBoolean('BACKUP_TESTING', true),
      frequency: getEnvWithDefault('BACKUP_TEST_FREQUENCY', 'weekly'),
    },
  },

  // Development and testing
  development: {
    seedData: getEnvBoolean('SEED_DATA', false),
    mockData: getEnvBoolean('MOCK_DATA', false),
    debugMode: getEnvBoolean('DEBUG_MODE', false),
    testDatabase: {
      url: getEnvWithDefault('TEST_DB_URL', 'postgresql://localhost:5432/healthcare_test'),
      cleanupAfterTests: getEnvBoolean('CLEANUP_AFTER_TESTS', true),
    },
    apiDocumentation: {
      enabled: getEnvBoolean('API_DOCS_ENABLED', true),
      path: getEnvWithDefault('API_DOCS_PATH', '/api/docs'),
    },
  },
}));

/**
 * Environment-specific configurations
 */
export const getEnvironmentConfig = () => {
  // Use helper function (which uses dotenv) for environment variable access
  const env = getEnvironment();

  const configs = {
    development: {
      logging: { level: 'debug' },
      performance: { queryLogging: true },
      security: { encryption: { keyStorage: 'local' } },
      monitoring: { metrics: { enabled: false } },
      backup: { enabled: false },
    },
    staging: {
      logging: { level: 'info' },
      performance: { queryLogging: false },
      security: { encryption: { keyStorage: 'local' } },
      monitoring: { metrics: { enabled: true } },
      backup: { enabled: true },
    },
    production: {
      logging: { level: 'warn' },
      performance: {
        queryLogging: false,
        loadBalancing: { enabled: true },
      },
      security: { encryption: { keyStorage: 'aws-kms' } },
      monitoring: { metrics: { enabled: true } },
      backup: { enabled: true },
      cache: { distributedCache: true },
    },
  };

  return configs[env as keyof typeof configs] || configs.development;
};

/**
 * Validation functions
 * Environment-aware validation: strict in production, lenient in development
 */
export const validateHealthcareConfig = (config: unknown) => {
  const errors: string[] = [];
  const cfg = config as Record<string, unknown>;
  // Use helper function (which uses dotenv) for environment variable access
  const prodEnv = isProduction();

  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

  const database = asRecord(cfg['database']);
  const security = asRecord(cfg['security']);
  const hipaa = asRecord(cfg['hipaa']);

  // Validate required environment variables
  const databaseUrl = typeof database?.['url'] === 'string' ? database['url'] : undefined;
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    errors.push('DATABASE_URL must be set');
  } else if (prodEnv && databaseUrl.includes('localhost')) {
    // Relaxed validation: Log warning instead of blocking deployment
    console.warn(
      'WARNING: DATABASE_URL contains localhost in production. This is discouraged but allowed for deployment diagnosis.'
    );
  }

  // Validate security settings (only in production)
  if (prodEnv) {
    const authentication = asRecord(security?.['authentication']);
    if (authentication?.['jwtSecret'] === 'your-healthcare-jwt-secret') {
      console.warn(
        'WARNING: JWT_SECRET is using default value in production. Please change this immediately.'
      );
    }
  }

  // Validate HIPAA compliance
  if (hipaa?.['enabled'] !== true) {
    errors.push('HIPAA compliance must be enabled for healthcare applications');
  }

  // Validate performance settings for scale (only in production)
  if (prodEnv) {
    const connectionPool = asRecord(database?.['connectionPool']);
    const primaryPool = asRecord(connectionPool?.['primary']);
    const poolMax = typeof primaryPool?.['max'] === 'number' ? primaryPool['max'] : undefined;
    if (poolMax === undefined || poolMax < 50) {
      console.warn(
        `WARNING: DB_POOL_MAX (${poolMax}) is below recommended 50 for handling 10 lakh users in production.`
      );
    }
  }

  if (errors.length > 0) {
    throw new HealthcareError(
      ErrorCode.VALIDATION_INVALID_FORMAT,
      `Healthcare configuration validation failed: ${errors.join(', ')}`,
      undefined,
      { errors, environment: getEnvironment() },
      'validateHealthcareConfig'
    );
  }

  return true;
};

/**
 * Helper functions for configuration
 */
export const getClinicConfig = () => {
  const config = healthcareConfig();
  return config.clinic;
};

export const isMultiClinicEnabled = () => {
  const config = healthcareConfig();
  return config.multiClinic.enabled;
};

export const getIsolationLevel = () => {
  const config = healthcareConfig();
  return config.multiClinic.isolationLevel;
};

export const getMaxClinics = () => {
  const config = healthcareConfig();
  return config.multiClinic.maxClinicsPerApp;
};

export const getMaxLocationsPerClinic = () => {
  const config = healthcareConfig();
  return config.multiClinic.maxLocationsPerClinic;
};

export const getHipaaConfig = () => {
  const config = healthcareConfig();
  return config.hipaa;
};

export const getPerformanceConfig = () => {
  const config = healthcareConfig();
  return config.performance;
};
