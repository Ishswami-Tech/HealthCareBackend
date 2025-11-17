/**
 * Cache Key Factory
 * @class CacheKeyFactory
 * @description Centralized cache key generation (DRY principle)
 */

import { Injectable } from '@nestjs/common';
import type { ICacheKeyFactory } from '@core/types';

/**
 * Cache key factory implementation
 * Centralizes all cache key generation logic to avoid duplication
 */
@Injectable()
export class CacheKeyFactory implements ICacheKeyFactory {
  private readonly KEY_SEPARATOR = ':';
  private readonly KEY_PREFIX = 'healthcare';

  /**
   * Generate patient-specific cache key
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
   * Generate doctor-specific cache key
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
   * Generate appointment-specific cache key
   */
  appointment(appointmentId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'appointment', appointmentId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate clinic-specific cache key
   */
  clinic(clinicId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'clinic', clinicId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate medical history cache key
   */
  medicalHistory(patientId: string, clinicId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'medical', patientId, 'clinic', clinicId, 'history'];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate prescription cache key
   */
  prescription(patientId: string, clinicId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'prescriptions', patientId, 'clinic', clinicId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate lab results cache key
   */
  labResults(patientId: string, clinicId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'lab', patientId, 'clinic', clinicId, 'results'];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate emergency contacts cache key
   */
  emergencyContacts(patientId: string): string {
    return [this.KEY_PREFIX, 'patient', patientId, 'emergency_contacts'].join(this.KEY_SEPARATOR);
  }

  /**
   * Generate user permissions cache key
   */
  userPermissions(userId: string, clinicId: string): string {
    return [this.KEY_PREFIX, 'user', userId, 'clinic', clinicId, 'permissions'].join(
      this.KEY_SEPARATOR
    );
  }

  /**
   * Generate custom cache key from template
   */
  fromTemplate(template: string, params: Record<string, string | number>): string {
    let key = template;
    for (const [param, value] of Object.entries(params)) {
      const placeholder = `{${param}}`;
      key = key.replace(placeholder, String(value));
    }
    return key.startsWith(this.KEY_PREFIX) ? key : `${this.KEY_PREFIX}:${key}`;
  }

  /**
   * Generate daily cache key (includes date)
   */
  daily(entityId: string, entityType: string, suffix?: string): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const parts = [this.KEY_PREFIX, 'daily', date, entityType, entityId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }
}
