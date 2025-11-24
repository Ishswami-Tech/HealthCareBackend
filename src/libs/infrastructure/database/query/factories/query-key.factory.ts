/**
 * Query Key Factory
 * @class QueryKeyFactory
 * @description Centralized query cache key generation (DRY principle)
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable } from '@nestjs/common';

/**
 * Query key factory implementation
 * Centralizes all query cache key generation logic to avoid duplication
 */
@Injectable()
export class QueryKeyFactory {
  private readonly KEY_SEPARATOR = ':';
  private readonly KEY_PREFIX = 'healthcare:query';

  /**
   * Generate user-specific query cache key
   */
  user(userId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'user', userId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate patient-specific query cache key
   */
  patient(patientId: string, clinicId?: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'patient', patientId];
    if (clinicId) {
      parts.push('clinic', clinicId);
    }
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate doctor-specific query cache key
   */
  doctor(doctorId: string, clinicId?: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'doctor', doctorId];
    if (clinicId) {
      parts.push('clinic', clinicId);
    }
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate appointment-specific query cache key
   */
  appointment(appointmentId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'appointment', appointmentId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate clinic-specific query cache key
   */
  clinic(clinicId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'clinic', clinicId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate query cache key from operation and parameters
   */
  fromOperation(operation: string, params?: Record<string, unknown>): string {
    const parts = [this.KEY_PREFIX, 'operation', operation];
    if (params) {
      const paramString = JSON.stringify(params);
      // Hash long parameter strings to keep keys manageable
      if (paramString.length > 100) {
        // Simple hash for long strings
        let hash = 0;
        for (let i = 0; i < paramString.length; i++) {
          const char = paramString.charCodeAt(i);
          hash = (hash << 5) - hash + char;
          hash = hash & hash; // Convert to 32-bit integer
        }
        parts.push(`params:${Math.abs(hash).toString(36)}`);
      } else {
        parts.push(`params:${paramString}`);
      }
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate generic query cache key
   */
  generic(entity: string, id: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, entity, id];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }
}
