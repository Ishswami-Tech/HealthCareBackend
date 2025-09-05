import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis/redis.service';

export interface HealthcareCacheConfig {
  patientRecordsTTL: number;
  appointmentsTTL: number;
  doctorProfilesTTL: number;
  clinicDataTTL: number;
  medicalHistoryTTL: number;
  prescriptionsTTL: number;
  emergencyDataTTL: number;
  enableCompression: boolean;
  enableMetrics: boolean;
  defaultTTL: number;
  maxCacheSize: number; // Maximum cache size in MB
  enableBatchOperations: boolean; // Enable batch cache operations
  compressionThreshold: number; // Compress values larger than this size
}

export interface CacheInvalidationEvent {
  type: 'patient_updated' | 'appointment_changed' | 'doctor_updated' | 'clinic_updated' | 'prescription_created';
  entityId: string;
  clinicId?: string;
  userId?: string;
  timestamp: Date;
  affectedPatterns: string[];
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly config: HealthcareCacheConfig;

  // Healthcare-specific cache key patterns
  private readonly CACHE_PATTERNS = {
    PATIENT_RECORDS: (patientId: string, clinicId: string) => `patient:${patientId}:clinic:${clinicId}:records`,
    PATIENT_PROFILE: (patientId: string) => `patient:${patientId}:profile`,
    PATIENT_APPOINTMENTS: (patientId: string, clinicId: string) => `patient:${patientId}:clinic:${clinicId}:appointments`,
    DOCTOR_PROFILE: (doctorId: string) => `doctor:${doctorId}:profile`,
    DOCTOR_SCHEDULE: (doctorId: string, date: string) => `doctor:${doctorId}:schedule:${date}`,
    DOCTOR_APPOINTMENTS: (doctorId: string, clinicId: string) => `doctor:${doctorId}:clinic:${clinicId}:appointments`,
    CLINIC_INFO: (clinicId: string) => `clinic:${clinicId}:info`,
    CLINIC_DOCTORS: (clinicId: string) => `clinic:${clinicId}:doctors`,
    CLINIC_PATIENTS: (clinicId: string) => `clinic:${clinicId}:patients`,
    MEDICAL_HISTORY: (patientId: string, clinicId: string) => `medical:${patientId}:clinic:${clinicId}:history`,
    PRESCRIPTIONS: (patientId: string, clinicId: string) => `prescriptions:${patientId}:clinic:${clinicId}`,
    APPOINTMENT_DETAILS: (appointmentId: string) => `appointment:${appointmentId}:details`,
    USER_PERMISSIONS: (userId: string, clinicId: string) => `user:${userId}:clinic:${clinicId}:permissions`,
    EMERGENCY_CONTACTS: (patientId: string) => `patient:${patientId}:emergency_contacts`,
    VITAL_SIGNS: (patientId: string, date: string) => `patient:${patientId}:vitals:${date}`,
    LAB_RESULTS: (patientId: string, clinicId: string) => `lab:${patientId}:clinic:${clinicId}:results`,
  };

  // Healthcare-specific cache tags for grouped invalidation
  private readonly CACHE_TAGS = {
    PATIENT: (patientId: string) => `patient:${patientId}`,
    DOCTOR: (doctorId: string) => `doctor:${doctorId}`,
    CLINIC: (clinicId: string) => `clinic:${clinicId}`,
    USER: (userId: string) => `user:${userId}`,
    APPOINTMENT: (appointmentId: string) => `appointment:${appointmentId}`,
    MEDICAL_RECORD: (recordId: string) => `medical_record:${recordId}`,
    PRESCRIPTION: (prescriptionId: string) => `prescription:${prescriptionId}`,
    EMERGENCY_DATA: 'emergency_data',
    CRITICAL_PATIENT_DATA: 'critical_patient_data',
    PHI_DATA: 'phi_data', // Protected Health Information
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService
  ) {
    this.config = {
      patientRecordsTTL: this.configService.get('CACHE_PATIENT_RECORDS_TTL', 3600), // 1 hour
      appointmentsTTL: this.configService.get('CACHE_APPOINTMENTS_TTL', 1800), // 30 minutes
      doctorProfilesTTL: this.configService.get('CACHE_DOCTOR_PROFILES_TTL', 7200), // 2 hours
      clinicDataTTL: this.configService.get('CACHE_CLINIC_DATA_TTL', 14400), // 4 hours
      medicalHistoryTTL: this.configService.get('CACHE_MEDICAL_HISTORY_TTL', 7200), // 2 hours
      prescriptionsTTL: this.configService.get('CACHE_PRESCRIPTIONS_TTL', 1800), // 30 minutes
      emergencyDataTTL: this.configService.get('CACHE_EMERGENCY_DATA_TTL', 300), // 5 minutes
      enableCompression: this.configService.get('CACHE_ENABLE_COMPRESSION', true),
      enableMetrics: this.configService.get('CACHE_ENABLE_METRICS', true),
      defaultTTL: this.configService.get('CACHE_DEFAULT_TTL', 3600), // 1 hour
      maxCacheSize: this.configService.get('CACHE_MAX_SIZE_MB', 1024), // 1GB
      enableBatchOperations: this.configService.get('CACHE_ENABLE_BATCH', true),
      compressionThreshold: this.configService.get('CACHE_COMPRESSION_THRESHOLD', 1024), // 1KB
    };
  }

  async onModuleInit() {
    this.logger.log('Cache Service initialized with HIPAA-compliant patterns');
  }

  async onModuleDestroy() {
    this.logger.log('Cache Service shutting down');
  }

  /**
   * Cache patient records with healthcare-specific optimizations
   */
  async cachePatientRecords<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: {
      includeHistory?: boolean;
      includePrescriptions?: boolean;
      includeVitals?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.PATIENT_RECORDS(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA,
      this.CACHE_TAGS.CRITICAL_PATIENT_DATA
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.patientRecordsTTL,
      compress: this.config.enableCompression,
      priority: 'high',
      tags,
      enableSwr: true
    });
  }

  /**
   * Cache doctor appointments with real-time updates
   */
  async cacheDoctorAppointments<T>(
    doctorId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: {
      date?: string;
      includePatientData?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.DOCTOR_APPOINTMENTS(doctorId, clinicId);
    const tags = [
      this.CACHE_TAGS.DOCTOR(doctorId),
      this.CACHE_TAGS.CLINIC(clinicId)
    ];

    if (options.includePatientData) {
      tags.push(this.CACHE_TAGS.PHI_DATA);
    }

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.appointmentsTTL,
      staleTime: 300, // 5 minutes stale time for real-time updates
      priority: 'high',
      tags,
      enableSwr: true
    });
  }

  /**
   * Cache patient medical history with compliance considerations
   */
  async cacheMedicalHistory<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: {
      timeRange?: { start: Date; end: Date };
      includeTests?: boolean;
      includeImages?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.MEDICAL_HISTORY(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.medicalHistoryTTL,
      compress: true, // Medical history can be large
      priority: 'high',
      tags,
      enableSwr: true
    });
  }

  /**
   * Cache emergency data with minimal TTL for critical scenarios
   */
  async cacheEmergencyData<T>(
    patientId: string,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.EMERGENCY_CONTACTS(patientId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.EMERGENCY_DATA,
      this.CACHE_TAGS.CRITICAL_PATIENT_DATA
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.emergencyDataTTL,
      priority: 'high',
      tags,
      enableSwr: false // No SWR for emergency data - always fresh
    });
  }

  /**
   * Cache prescription data with pharmacy integration considerations
   */
  async cachePrescriptions<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: {
      includeHistory?: boolean;
      activeOnly?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.PRESCRIPTIONS(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.prescriptionsTTL,
      priority: 'high',
      tags,
      enableSwr: true
    });
  }

  /**
   * Cache vital signs with time-series optimization
   */
  async cacheVitalSigns<T>(
    patientId: string,
    date: string,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.VITAL_SIGNS(patientId, date);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.PHI_DATA
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.patientRecordsTTL,
      priority: 'high',
      tags,
      enableSwr: true
    });
  }

  /**
   * Cache lab results with integration awareness
   */
  async cacheLabResults<T>(
    patientId: string,
    clinicId: string,
    fetchFn: () => Promise<T>,
    options: {
      includeImages?: boolean;
      includeReports?: boolean;
    } = {}
  ): Promise<T> {
    const cacheKey = this.CACHE_PATTERNS.LAB_RESULTS(patientId, clinicId);
    const tags = [
      this.CACHE_TAGS.PATIENT(patientId),
      this.CACHE_TAGS.CLINIC(clinicId),
      this.CACHE_TAGS.PHI_DATA
    ];

    return this.redisService.cache(cacheKey, fetchFn, {
      ttl: this.config.medicalHistoryTTL,
      compress: options.includeImages || options.includeReports,
      priority: 'high',
      tags,
      enableSwr: true
    });
  }

  /**
   * Invalidate patient-related cache when patient data changes
   */
  async invalidatePatientCache(patientId: string, clinicId?: string): Promise<void> {
    const patterns = [
      `patient:${patientId}:*`,
      `medical:${patientId}:*`,
      `prescriptions:${patientId}:*`,
      `lab:${patientId}:*`
    ];

    if (clinicId) {
      patterns.push(`*:clinic:${clinicId}:*`);
    }

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.redisService.invalidateCacheByPattern(pattern);
    }

    // Invalidate by tags
    await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.PATIENT(patientId));
    if (clinicId) {
      await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.CLINIC(clinicId));
    }

    // Emit invalidation event
    await this.emitCacheInvalidationEvent({
      type: 'patient_updated',
      entityId: patientId,
      clinicId,
      timestamp: new Date(),
      affectedPatterns: patterns
    });

    this.logger.debug(`Invalidated patient cache for patient: ${patientId}, clinic: ${clinicId || 'all'}`);
  }

  /**
   * Invalidate doctor-related cache when doctor data changes
   */
  async invalidateDoctorCache(doctorId: string, clinicId?: string): Promise<void> {
    const patterns = [
      `doctor:${doctorId}:*`
    ];

    if (clinicId) {
      patterns.push(`*:clinic:${clinicId}:doctors`);
    }

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.redisService.invalidateCacheByPattern(pattern);
    }

    // Invalidate by tags
    await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.DOCTOR(doctorId));
    if (clinicId) {
      await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.CLINIC(clinicId));
    }

    await this.emitCacheInvalidationEvent({
      type: 'doctor_updated',
      entityId: doctorId,
      clinicId,
      timestamp: new Date(),
      affectedPatterns: patterns
    });

    this.logger.debug(`Invalidated doctor cache for doctor: ${doctorId}, clinic: ${clinicId || 'all'}`);
  }

  /**
   * Invalidate appointment-related cache
   */
  async invalidateAppointmentCache(appointmentId: string, patientId?: string, doctorId?: string, clinicId?: string): Promise<void> {
    const patterns = [
      `appointment:${appointmentId}:*`
    ];

    if (patientId) {
      patterns.push(`patient:${patientId}:*:appointments`);
    }

    if (doctorId) {
      patterns.push(`doctor:${doctorId}:*:appointments`);
    }

    if (clinicId) {
      patterns.push(`*:clinic:${clinicId}:appointments`);
    }

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.redisService.invalidateCacheByPattern(pattern);
    }

    // Invalidate by tags
    await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.APPOINTMENT(appointmentId));

    await this.emitCacheInvalidationEvent({
      type: 'appointment_changed',
      entityId: appointmentId,
      clinicId,
      userId: patientId || doctorId,
      timestamp: new Date(),
      affectedPatterns: patterns
    });

    this.logger.debug(`Invalidated appointment cache for appointment: ${appointmentId}`);
  }

  /**
   * Invalidate clinic-wide cache
   */
  async invalidateClinicCache(clinicId: string): Promise<void> {
    const patterns = [
      `clinic:${clinicId}:*`,
      `*:clinic:${clinicId}:*`
    ];

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.redisService.invalidateCacheByPattern(pattern);
    }

    // Invalidate by tag
    await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.CLINIC(clinicId));

    await this.emitCacheInvalidationEvent({
      type: 'clinic_updated',
      entityId: clinicId,
      clinicId,
      timestamp: new Date(),
      affectedPatterns: patterns
    });

    this.logger.debug(`Invalidated clinic cache for clinic: ${clinicId}`);
  }

  /**
   * Clear all PHI (Protected Health Information) data from cache
   * Used for compliance and emergency scenarios
   */
  async clearPHICache(): Promise<number> {
    this.logger.warn('Clearing all PHI data from cache for compliance');
    
    const clearedCount = await this.redisService.invalidateCacheByTag(this.CACHE_TAGS.PHI_DATA);
    
    this.logger.log(`Cleared ${clearedCount} PHI cache entries`);
    return clearedCount;
  }

  /**
   * Get healthcare cache metrics
   */
  async getHealthcareCacheMetrics(): Promise<{
    patientCacheHits: number;
    appointmentCacheHits: number;
    doctorCacheHits: number;
    emergencyCacheHits: number;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
  }> {
    const baseMetrics = await this.redisService.getCacheStats();
    
    // In a real implementation, you would track healthcare-specific metrics
    return {
      patientCacheHits: Math.floor(baseMetrics.hits * 0.4), // Estimate
      appointmentCacheHits: Math.floor(baseMetrics.hits * 0.3),
      doctorCacheHits: Math.floor(baseMetrics.hits * 0.2),
      emergencyCacheHits: Math.floor(baseMetrics.hits * 0.1),
      totalHits: baseMetrics.hits,
      totalMisses: baseMetrics.misses,
      hitRate: baseMetrics.hits / (baseMetrics.hits + baseMetrics.misses) || 0
    };
  }

  /**
   * Warm cache with frequently accessed healthcare data
   */
  async warmHealthcareCache(clinicId: string): Promise<void> {
    this.logger.log(`Warming healthcare cache for clinic: ${clinicId}`);
    
    try {
      // This would typically pre-load common data like:
      // - Active doctors
      // - Today's appointments
      // - Emergency contacts
      // - Clinic configuration
      
      // For now, we'll just log the warming process
      this.logger.debug('Cache warming completed - this would pre-load common healthcare data');
    } catch (error) {
      this.logger.error('Error warming healthcare cache:', error);
    }
  }

  /**
   * Emit cache invalidation event for cross-service coordination
   */
  private async emitCacheInvalidationEvent(event: CacheInvalidationEvent): Promise<void> {
    try {
      // Store the invalidation event for audit purposes
      const eventKey = `cache:invalidation:events`;
      await this.redisService.rPush(eventKey, JSON.stringify(event));
      await this.redisService.lTrim(eventKey, -1000, -1); // Keep last 1000 events
      
      // Set expiry for events (30 days)
      await this.redisService.expire(eventKey, 30 * 24 * 60 * 60);
    } catch (error) {
      this.logger.error('Error emitting cache invalidation event:', error);
    }
  }

  /**
   * Get cache invalidation event history
   */
  async getCacheInvalidationHistory(limit: number = 100): Promise<CacheInvalidationEvent[]> {
    try {
      const eventKey = `cache:invalidation:events`;
      const events = await this.redisService.lRange(eventKey, -limit, -1);
      
      return events.map(eventStr => JSON.parse(eventStr) as CacheInvalidationEvent);
    } catch (error) {
      this.logger.error('Error getting cache invalidation history:', error);
      return [];
    }
  }

  /**
   * Batch cache operations for better performance
   */
  async batchGet<T>(keys: string[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();
    
    try {
      // Use Promise.all for concurrent operations
      const promises = keys.map(async (key) => {
        const value = await this.redisService.get(key);
        return { key, value: value ? JSON.parse(value) : null };
      });
      
      const batchResults = await Promise.all(promises);
      
      batchResults.forEach(({ key, value }) => {
        results.set(key, value);
      });
      
      return results;
    } catch (error) {
      this.logger.error('Batch get operation failed:', error);
      throw error;
    }
  }

  /**
   * Batch set operations for better performance
   */
  async batchSet<T>(keyValuePairs: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    try {
      // Use Promise.all for concurrent operations
      const promises = keyValuePairs.map(async ({ key, value, ttl }) => {
        await this.redisService.set(key, JSON.stringify(value), ttl || this.config.defaultTTL);
      });
      
      await Promise.all(promises);
    } catch (error) {
      this.logger.error('Batch set operation failed:', error);
      throw error;
    }
  }

  /**
   * Batch delete operations for better performance
   */
  async batchDelete(keys: string[]): Promise<number> {
    try {
      // Use Promise.all for concurrent operations
      const promises = keys.map(async (key) => {
        await this.redisService.del(key);
        return 1; // Each successful delete counts as 1
      });
      
      const results = await Promise.all(promises);
      return results.reduce((sum, count) => sum + count, 0);
    } catch (error) {
      this.logger.error('Batch delete operation failed:', error);
      throw error;
    }
  }

  /**
   * Delete a single cache key
   */
  async delete(key: string): Promise<boolean> {
    try {
      await this.redisService.del(key);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete cache key ${key}:`, error);
      return false;
    }
  }

  /**
   * Warm cache for a clinic with frequently accessed data
   */
  async warmClinicCache(clinicId: string): Promise<void> {
    this.logger.log(`Starting cache warming for clinic: ${clinicId}`);
    
    try {
      // Warm clinic information
      const clinicInfoKey = this.CACHE_PATTERNS.CLINIC_INFO(clinicId);
      await this.redisService.set(clinicInfoKey, JSON.stringify({
        id: clinicId,
        name: 'Clinic',
        status: 'active'
      }), this.config.clinicDataTTL);

      // Warm doctor profiles
      const doctorsKey = this.CACHE_PATTERNS.CLINIC_DOCTORS(clinicId);
      await this.redisService.set(doctorsKey, JSON.stringify([]), this.config.doctorProfilesTTL);

      this.logger.log(`Cache warming completed for clinic: ${clinicId}`);
    } catch (error) {
      this.logger.error(`Cache warming failed for clinic: ${clinicId}`, error);
      throw error;
    }
  }

  /**
   * Get cache health status
   */
  async getCacheHealth(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    memoryUsage: number;
    hitRate: number;
    connectionStatus: boolean;
    lastHealthCheck: Date;
  }> {
    try {
      const connectionStatus = await this.redisService.healthCheck();
      const stats = await this.redisService.getCacheStats();
      
      const hitRate = stats.hits / (stats.hits + stats.misses) || 0;
      
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (hitRate < 0.7) status = 'warning';
      if (hitRate < 0.5 || !connectionStatus) status = 'critical';
      
      return {
        status,
        memoryUsage: 0, // RedisService doesn't expose memory info directly
        hitRate,
        connectionStatus,
        lastHealthCheck: new Date(),
      };
    } catch (error) {
      this.logger.error('Cache health check failed:', error);
      return {
        status: 'critical',
        memoryUsage: 0,
        hitRate: 0,
        connectionStatus: false,
        lastHealthCheck: new Date(),
      };
    }
  }

  // Basic cache operations - delegate to RedisService
  async get<T>(key: string): Promise<T | null> {
    return this.redisService.get<T>(key);
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    return this.redisService.set(key, value, ttl);
  }

  async del(...keys: string[]): Promise<void> {
    return this.redisService.del(...keys);
  }

  async invalidateCache(key: string): Promise<boolean> {
    return this.redisService.invalidateCache(key);
  }

  async invalidateCacheByTag(tag: string): Promise<number> {
    return this.redisService.invalidateCacheByTag(tag);
  }

  // Additional Redis operations needed by other services
  async invalidateByPattern(pattern: string): Promise<number> {
    return this.redisService.invalidateCacheByPattern(pattern);
  }

  async delPattern(pattern: string): Promise<number> {
    return this.redisService.invalidateCacheByPattern(pattern);
  }

  // List operations
  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redisService.lRange(key, start, stop);
  }

  async lLen(key: string): Promise<number> {
    return this.redisService.lLen(key);
  }

  async rPush(key: string, value: string): Promise<number> {
    return this.redisService.rPush(key, value);
  }

  // Key operations
  async keys(pattern: string): Promise<string[]> {
    return this.redisService.keys(pattern);
  }

  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.redisService.zadd(key, score, member);
  }

  async zcard(key: string): Promise<number> {
    return this.redisService.zcard(key);
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.redisService.zremrangebyscore(key, min, max);
  }

  // Hash operations
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.redisService.hincrby(key, field, increment);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.redisService.hGetAll(key);
  }

  // Key expiration
  async expire(key: string, seconds: number): Promise<number> {
    return this.redisService.expire(key, seconds);
  }

  // Connection test
  async ping(): Promise<string> {
    return this.redisService.ping();
  }

  // Development mode check
  get isDevelopmentMode(): boolean {
    return this.redisService.isDevelopmentMode();
  }

  // Cache debug info
  async getCacheDebug(): Promise<any> {
    return this.redisService.getCacheDebug();
  }

}