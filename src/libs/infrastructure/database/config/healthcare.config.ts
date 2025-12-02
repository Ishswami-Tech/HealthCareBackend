import { registerAs } from '@nestjs/config';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

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
  multiClinic: {
    enabled: process.env['MULTI_CLINIC_ENABLED'] === 'true' || true,
    isolationLevel: process.env['CLINIC_ISOLATION_LEVEL'] || 'row', // 'row' | 'schema'
    maxClinicsPerApp: parseInt(process.env['MAX_CLINICS_PER_APP'] || '200', 10),
    maxLocationsPerClinic: parseInt(process.env['MAX_LOCATIONS_PER_CLINIC'] || '50', 10),
  },

  // Enterprise Database configuration for 1M+ users
  database: {
    url: process.env['DATABASE_URL'] || 'postgresql://localhost:5432/healthcare',
    schema: 'healthcare',
    ssl: process.env['DATABASE_SSL'] === 'true' || false,
    connectionPool: {
      // Enhanced connection pooling for 1M+ users
      primary: {
        min: parseInt(process.env['DB_POOL_MIN'] || '50', 10), // Increased for scale
        max: parseInt(process.env['DB_POOL_MAX'] || '500', 10), // Increased for 1M users
        acquireTimeout: parseInt(process.env['DB_POOL_ACQUIRE_TIMEOUT'] || '60000', 10),
        idleTimeout: parseInt(process.env['DB_POOL_IDLE_TIMEOUT'] || '300000', 10),
        reapInterval: parseInt(process.env['DB_POOL_REAP_INTERVAL'] || '1000', 10),
        createTimeout: parseInt(process.env['DB_POOL_CREATE_TIMEOUT'] || '30000', 10),
        destroyTimeout: parseInt(process.env['DB_POOL_DESTROY_TIMEOUT'] || '5000', 10),
        createRetryInterval: parseInt(process.env['DB_POOL_CREATE_RETRY_INTERVAL'] || '200', 10),
      },
      // Read replica support for scaling reads
      readReplicas: {
        enabled: process.env['DB_READ_REPLICAS_ENABLED'] === 'true' || false,
        min: parseInt(process.env['DB_READ_POOL_MIN'] || '25', 10),
        max: parseInt(process.env['DB_READ_POOL_MAX'] || '200', 10),
        loadBalancing: process.env['DB_LOAD_BALANCING'] || 'round-robin',
        failover: process.env['DB_FAILOVER'] === 'true' || true,
        urls: process.env['READ_REPLICA_URLS'] ? process.env['READ_REPLICA_URLS'].split(',') : [],
      },
      // Connection validation for reliability
      validation: {
        enabled: true,
        query: 'SELECT 1',
        interval: parseInt(process.env['DB_VALIDATION_INTERVAL'] || '30000', 10),
        timeout: parseInt(process.env['DB_VALIDATION_TIMEOUT'] || '5000', 10),
      },
    },
    // Advanced query optimization for 1M users
    queryOptimization: {
      enabled: true,
      batchSize: parseInt(process.env['DB_BATCH_SIZE'] || '2000', 10), // Larger batches for scale
      parallelQueries: parseInt(process.env['DB_PARALLEL_QUERIES'] || '20', 10), // More parallel processing
      queryCache: {
        enabled: process.env['DB_QUERY_CACHE'] === 'true' || true,
        ttl: parseInt(process.env['DB_QUERY_CACHE_TTL'] || '300', 10),
        maxSize: parseInt(process.env['DB_QUERY_CACHE_MAX_SIZE'] || '50000', 10), // Larger cache
      },
      resultCache: {
        enabled: process.env['DB_RESULT_CACHE'] === 'true' || true,
        ttl: parseInt(process.env['DB_RESULT_CACHE_TTL'] || '600', 10),
        maxSize: parseInt(process.env['DB_RESULT_CACHE_MAX_SIZE'] || '100000', 10), // Larger cache
      },
      // Circuit breaker for resilience
      circuitBreaker: {
        enabled: process.env['DB_CIRCUIT_BREAKER'] === 'true' || true,
        failureThreshold: parseInt(process.env['DB_CIRCUIT_BREAKER_THRESHOLD'] || '5', 10),
        timeout: parseInt(process.env['DB_CIRCUIT_BREAKER_TIMEOUT'] || '30000', 10),
        resetTimeout: parseInt(process.env['DB_CIRCUIT_BREAKER_RESET'] || '60000', 10),
      },
    },
    // Performance tuning for massive scale
    performance: {
      // Memory optimization for large scale
      memory: {
        sharedBuffers: process.env['DB_SHARED_BUFFERS'] || '512MB',
        effectiveCacheSize: process.env['DB_EFFECTIVE_CACHE_SIZE'] || '4GB',
        workMem: process.env['DB_WORK_MEM'] || '8MB',
        maintenanceWorkMem: process.env['DB_MAINTENANCE_WORK_MEM'] || '256MB',
        maxConnections: parseInt(process.env['DB_MAX_CONNECTIONS'] || '500', 10),
      },
      // WAL configuration for high throughput
      wal: {
        enabled: process.env['DB_WAL_ENABLED'] === 'true' || true,
        level: process.env['DB_WAL_LEVEL'] || 'replica',
        keepSegments: parseInt(process.env['DB_WAL_KEEP_SEGMENTS'] || '128', 10),
        archiveTimeout: parseInt(process.env['DB_WAL_ARCHIVE_TIMEOUT'] || '60', 10),
      },
      // Auto-scaling configuration
      autoScaling: {
        enabled: process.env['DB_AUTO_SCALING_ENABLED'] === 'true' || true,
        cpuThreshold: parseInt(process.env['DB_AUTO_SCALING_CPU_THRESHOLD'] || '75', 10),
        connectionThreshold: parseInt(
          process.env['DB_AUTO_SCALING_CONNECTION_THRESHOLD'] || '400',
          10
        ),
        scaleUpCooldown: parseInt(process.env['DB_SCALE_UP_COOLDOWN'] || '300', 10),
        scaleDownCooldown: parseInt(process.env['DB_SCALE_DOWN_COOLDOWN'] || '1800', 10),
      },
    },
  },

  // Cache settings - Optimized for 10M+ users
  // Note: Cache enabled status is controlled by cache.config.ts (single source of truth)
  cache: {
    enabled: process.env['CACHE_ENABLED'] === 'true',
    ttl: parseInt(process.env['CACHE_TTL'] || '300', 10), // 5 minutes
    maxSize: parseInt(process.env['CACHE_MAX_SIZE'] || '100000', 10), // Increased from 10000 to 100000 for 10M+ users

    // Clinic-specific cache TTL
    clinicDataTtl: parseInt(process.env['CLINIC_CACHE_TTL'] || '3600', 10), // 1 hour
    patientDataTtl: parseInt(process.env['PATIENT_CACHE_TTL'] || '1800', 10), // 30 minutes
    appointmentDataTtl: parseInt(process.env['APPOINTMENT_CACHE_TTL'] || '300', 10), // 5 minutes
    emergencyDataTtl: parseInt(process.env['EMERGENCY_CACHE_TTL'] || '60', 10), // 1 minute
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
  security: {
    encryption: {
      algorithm: process.env['ENCRYPTION_ALGORITHM'] || 'AES-256-GCM',
      keyRotation: parseInt(process.env['ENCRYPTION_KEY_ROTATION_DAYS'] || '90', 10),
      keyStorage: process.env['ENCRYPTION_KEY_STORAGE'] || 'local', // 'aws-kms' | 'azure-keyvault' | 'local'
    },
    authentication: {
      jwtSecret: process.env['JWT_SECRET'] || 'your-healthcare-jwt-secret',
      jwtExpiration: process.env['JWT_EXPIRATION'] || '8h', // Shorter for healthcare
      refreshTokenExpiration: process.env['REFRESH_TOKEN_EXPIRATION'] || '24h',
      sessionTimeout: parseInt(process.env['SESSION_TIMEOUT'] || '28800', 10), // 8 hours
      passwordPolicy: {
        minLength: parseInt(process.env['PASSWORD_MIN_LENGTH'] || '12', 10), // Stricter for healthcare
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        preventReuse: parseInt(process.env['PASSWORD_HISTORY'] || '12', 10),
      },
    },
    rateLimit: {
      // Per-clinic rate limiting for better resource distribution
      perClinicLimits: {
        loginAttempts: parseInt(process.env['RATE_LIMIT_LOGIN'] || '5', 10),
        apiCalls: parseInt(process.env['RATE_LIMIT_API'] || '1000', 10),
        patientSearch: parseInt(process.env['RATE_LIMIT_PATIENT_SEARCH'] || '100', 10),
        appointmentBooking: parseInt(process.env['RATE_LIMIT_APPOINTMENT'] || '50', 10),
      },
      windowMs: parseInt(process.env['RATE_LIMIT_WINDOW'] || '900000', 10), // 15 minutes
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
    hl7Integration: process.env['HL7_INTEGRATION'] === 'true' || false,
    fhirCompliance: process.env['FHIR_COMPLIANCE'] === 'true' || false,
    icdIntegration: process.env['ICD_INTEGRATION'] === 'true' || false,
  },

  // Clinic configuration
  clinic: {
    requireVerification: process.env['CLINIC_VERIFICATION_REQUIRED'] === 'true' || true,
    maxStaffPerClinic: parseInt(process.env['MAX_STAFF_PER_CLINIC'] || '500', 10),
    maxPatientsPerClinic: parseInt(process.env['MAX_PATIENTS_PER_CLINIC'] || '25000', 10), // 10L users across 200 clinics = ~5K avg per clinic
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
      allowOverlapSchedules: process.env['ALLOW_OVERLAP_SCHEDULES'] === 'true' || false,
    },
  },

  // Performance and scaling for 10 lakh users
  performance: {
    connectionPooling: {
      enabled: true,
      strategy: 'round_robin', // 'round_robin' | 'least_connections'
      healthCheckInterval: parseInt(process.env['HEALTH_CHECK_INTERVAL'] || '30000', 10),
    },
    caching: {
      strategy: 'lru', // 'lru' | 'lfu' | 'fifo'
      distributedCache: process.env['DISTRIBUTED_CACHE'] === 'true' || true,
      cacheWarmup: process.env['CACHE_WARMUP'] === 'true' || true,
    },
    queryOptimization: {
      enabled: true,
      slowQueryThreshold: parseInt(process.env['SLOW_QUERY_THRESHOLD'] || '1000', 10),
      queryLogging: process.env['QUERY_LOGGING'] === 'true' || false,
      batchSize: parseInt(process.env['BATCH_SIZE'] || '100', 10),
    },
    loadBalancing: {
      enabled: process.env['LOAD_BALANCING'] === 'true' || false,
      algorithm: process.env['LOAD_BALANCE_ALGORITHM'] || 'round_robin',
    },
  },

  // Monitoring and observability
  monitoring: {
    metrics: {
      enabled: process.env['METRICS_ENABLED'] === 'true' || true,
      collectionInterval: parseInt(process.env['METRICS_COLLECTION_INTERVAL'] || '60000', 10),
      retentionPeriod: parseInt(process.env['METRICS_RETENTION_PERIOD'] || '604800', 10), // 7 days

      // Healthcare-specific metrics
      trackPatientMetrics: true,
      trackAppointmentMetrics: true,
      trackBillingMetrics: true,
      trackSystemPerformance: true,
    },
    logging: {
      level: process.env['LOG_LEVEL'] || 'info',
      format: process.env['LOG_FORMAT'] || 'json',
      destination: process.env['LOG_DESTINATION'] || 'file',

      // HIPAA-compliant logging
      auditLogging: true,
      securityEventLogging: true,
      dataAccessLogging: true,
      logRetention: parseInt(process.env['LOG_RETENTION_DAYS'] || '2555', 10), // 7 years
    },
    healthChecks: {
      enabled: true,
      interval: parseInt(process.env['HEALTH_CHECK_INTERVAL'] || '30000', 10),
      timeout: parseInt(process.env['HEALTH_CHECK_TIMEOUT'] || '5000', 10),
      endpoints: ['/health', '/health/db', '/health/cache', '/health/queue'],
    },
    alerts: {
      enabled: process.env['ALERTS_ENABLED'] === 'true' || true,
      emergencyAlerts: true,
      systemAlerts: true,
      securityAlerts: true,
      performanceAlerts: true,
    },
  },

  // Backup and disaster recovery
  backup: {
    enabled: process.env['BACKUP_ENABLED'] === 'true' || true,
    frequency: process.env['BACKUP_FREQUENCY'] || 'hourly', // More frequent for healthcare
    fullBackupFrequency: process.env['FULL_BACKUP_FREQUENCY'] || 'daily',
    retention: parseInt(process.env['BACKUP_RETENTION_DAYS'] || '365', 10), // 1 year

    storage: {
      type: process.env['BACKUP_STORAGE_TYPE'] || 'local', // 's3' | 'azure-blob' | 'local'
      path: process.env['BACKUP_STORAGE_PATH'] || './backups',
      compression: process.env['BACKUP_COMPRESSION'] === 'true' || true,
    },
    encryption: {
      enabled: true,
      algorithm: 'AES-256',
    },
    testing: {
      enabled: process.env['BACKUP_TESTING'] === 'true' || true,
      frequency: process.env['BACKUP_TEST_FREQUENCY'] || 'weekly',
    },
  },

  // Development and testing
  development: {
    seedData: process.env['SEED_DATA'] === 'true' || false,
    mockData: process.env['MOCK_DATA'] === 'true' || false,
    debugMode: process.env['DEBUG_MODE'] === 'true' || false,
    testDatabase: {
      url: process.env['TEST_DB_URL'] || 'postgresql://localhost:5432/healthcare_test',
      cleanupAfterTests: process.env['CLEANUP_AFTER_TESTS'] === 'true' || true,
    },
    apiDocumentation: {
      enabled: process.env['API_DOCS_ENABLED'] === 'true' || true,
      path: process.env['API_DOCS_PATH'] || '/api/docs',
    },
  },
}));

/**
 * Environment-specific configurations
 */
export const getEnvironmentConfig = () => {
  const env = process.env['NODE_ENV'] || 'development';

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
  const isProduction = process.env['NODE_ENV'] === 'production';

  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

  const database = asRecord(cfg['database']);
  const security = asRecord(cfg['security']);
  const hipaa = asRecord(cfg['hipaa']);

  // Validate required environment variables
  const databaseUrl = typeof database?.['url'] === 'string' ? database['url'] : undefined;
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    errors.push('DATABASE_URL must be set');
  } else if (isProduction && databaseUrl.includes('localhost')) {
    // Only enforce production database URL in production
    errors.push(
      'DATABASE_URL must be set to a valid production database URL (localhost not allowed in production)'
    );
  }

  // Validate security settings (only in production)
  if (isProduction) {
  const authentication = asRecord(security?.['authentication']);
  if (authentication?.['jwtSecret'] === 'your-healthcare-jwt-secret') {
      errors.push('JWT_SECRET must be changed from default value in production');
    }
  }

  // Validate HIPAA compliance
  if (hipaa?.['enabled'] !== true) {
    errors.push('HIPAA compliance must be enabled for healthcare applications');
  }

  // Validate performance settings for scale (only in production)
  if (isProduction) {
  const connectionPool = asRecord(database?.['connectionPool']);
  const primaryPool = asRecord(connectionPool?.['primary']);
  const poolMax = typeof primaryPool?.['max'] === 'number' ? primaryPool['max'] : undefined;
  if (poolMax === undefined || poolMax < 50) {
      errors.push('DB_POOL_MAX should be at least 50 for handling 10 lakh users in production');
    }
  }

  if (errors.length > 0) {
    throw new HealthcareError(
      ErrorCode.VALIDATION_INVALID_FORMAT,
      `Healthcare configuration validation failed: ${errors.join(', ')}`,
      undefined,
      { errors, environment: process.env['NODE_ENV'] || 'development' },
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
