/**
 * Cache Metrics Service
 * @class CacheMetricsService
 * @description Tracks and manages cache performance metrics
 */

import { Injectable } from '@nestjs/common';
import type { CachePerformanceMetrics } from '@core/types';

/**
 * Cache metrics service
 */
@Injectable()
export class CacheMetricsService {
  private metrics: CachePerformanceMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    p95ResponseTime: 0,
    p99ResponseTime: 0,
    cacheHitRate: 0,
    memoryUsage: 0,
    connectionPoolUtilization: 0,
    throughput: 0,
    errorRate: 0,
    timestamp: new Date(),
  };

  private readonly responseTimes: number[] = [];
  private hits = 0;
  private misses = 0;
  private readonly maxResponseTimeSamples = 1000;

  /**
   * Record cache operation
   */
  recordOperation(success: boolean, responseTime: number, isHit: boolean): void {
    const totalRequests = this.metrics.totalRequests + 1;
    const successfulRequests = success
      ? this.metrics.successfulRequests + 1
      : this.metrics.successfulRequests;
    const failedRequests = success ? this.metrics.failedRequests : this.metrics.failedRequests + 1;

    if (isHit) {
      this.hits++;
    } else {
      this.misses++;
    }

    // Track response times
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > this.maxResponseTimeSamples) {
      this.responseTimes.shift();
    }

    this.updateMetrics(totalRequests, successfulRequests, failedRequests);
  }

  /**
   * Update calculated metrics
   */
  private updateMetrics(
    totalRequests: number,
    successfulRequests: number,
    failedRequests: number
  ): void {
    const total = this.hits + this.misses;
    const cacheHitRate = total > 0 ? this.hits / total : 0;

    let averageResponseTime = 0;
    let p95ResponseTime = 0;
    let p99ResponseTime = 0;
    if (this.responseTimes.length > 0) {
      const sorted = [...this.responseTimes].sort((a, b) => a - b);
      averageResponseTime = sorted.reduce((sum, time) => sum + time, 0) / sorted.length;
      p95ResponseTime = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      p99ResponseTime = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    }

    const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;

    // Create new metrics object (all properties are readonly)
    this.metrics = {
      totalRequests,
      successfulRequests,
      failedRequests,
      averageResponseTime,
      p95ResponseTime,
      p99ResponseTime,
      cacheHitRate,
      memoryUsage: this.metrics.memoryUsage,
      connectionPoolUtilization: this.metrics.connectionPoolUtilization,
      throughput: this.metrics.throughput,
      errorRate,
      timestamp: new Date(),
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): Readonly<CachePerformanceMetrics> {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      cacheHitRate: 0,
      memoryUsage: 0,
      connectionPoolUtilization: 0,
      throughput: 0,
      errorRate: 0,
      timestamp: new Date(),
    };
    this.hits = 0;
    this.misses = 0;
    this.responseTimes.length = 0;
  }
}
