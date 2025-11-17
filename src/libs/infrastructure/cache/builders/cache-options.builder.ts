/**
 * Cache Options Builder
 * @class CacheOptionsBuilder
 * @description Builder pattern for constructing cache options
 */

import type { CacheOperationOptions } from '@core/types';

/**
 * Builder for cache operation options
 */
export class CacheOptionsBuilder {
  private options: Partial<CacheOperationOptions> = {};

  /**
   * Set TTL
   */
  ttl(ttl: number): this {
    this.options = { ...this.options, ttl };
    return this;
  }

  /**
   * Set stale time
   */
  staleTime(staleTime: number): this {
    this.options = { ...this.options, staleTime };
    return this;
  }

  /**
   * Enable force refresh
   */
  forceRefresh(force = true): this {
    this.options = { ...this.options, forceRefresh: force };
    return this;
  }

  /**
   * Enable compression
   */
  compress(compress = true): this {
    this.options = { ...this.options, compress };
    return this;
  }

  /**
   * Set priority
   */
  priority(priority: 'critical' | 'high' | 'normal' | 'low'): this {
    this.options = { ...this.options, priority };
    return this;
  }

  /**
   * Enable/disable SWR
   */
  enableSwr(enable = true): this {
    this.options = { ...this.options, enableSwr: enable };
    return this;
  }

  /**
   * Add tags
   */
  tags(tags: readonly string[]): this {
    this.options = { ...this.options, tags };
    return this;
  }

  /**
   * Mark as containing PHI
   */
  containsPHI(contains = true): this {
    this.options = { ...this.options, containsPHI: contains };
    return this;
  }

  /**
   * Set compliance level
   */
  complianceLevel(level: 'standard' | 'sensitive' | 'restricted'): this {
    this.options = { ...this.options, complianceLevel: level };
    return this;
  }

  /**
   * Mark as emergency data
   */
  emergencyData(emergency = true): this {
    this.options = { ...this.options, emergencyData: emergency };
    return this;
  }

  /**
   * Mark as patient-specific
   */
  patientSpecific(patient = true): this {
    this.options = { ...this.options, patientSpecific: patient };
    return this;
  }

  /**
   * Mark as doctor-specific
   */
  doctorSpecific(doctor = true): this {
    this.options = { ...this.options, doctorSpecific: doctor };
    return this;
  }

  /**
   * Mark as clinic-specific
   */
  clinicSpecific(clinic = true): this {
    this.options = { ...this.options, clinicSpecific: clinic };
    return this;
  }

  /**
   * Build final options
   */
  build(): CacheOperationOptions {
    return this.options as CacheOperationOptions;
  }

  /**
   * Reset builder
   */
  reset(): this {
    this.options = {};
    return this;
  }

  /**
   * Create builder for patient data
   */
  static forPatient(): CacheOptionsBuilder {
    return new CacheOptionsBuilder()
      .patientSpecific(true)
      .containsPHI(true)
      .complianceLevel('sensitive')
      .ttl(3600);
  }

  /**
   * Create builder for emergency data
   */
  static forEmergency(): CacheOptionsBuilder {
    return new CacheOptionsBuilder()
      .emergencyData(true)
      .priority('critical')
      .enableSwr(false)
      .ttl(300);
  }

  /**
   * Create builder for PHI data
   */
  static forPHI(): CacheOptionsBuilder {
    return new CacheOptionsBuilder().containsPHI(true).complianceLevel('sensitive').ttl(1800);
  }
}
