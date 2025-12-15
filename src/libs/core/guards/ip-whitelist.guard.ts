/**
 * IP Whitelist Guard
 * ==================
 * Restricts access to administrative endpoints based on IP whitelist
 *
 * @module IpWhitelistGuard
 * @description IP-based access control for sensitive administrative endpoints
 */

import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import type { FastifyRequest } from 'fastify';

/**
 * IP Whitelist Guard
 *
 * Validates that the request originates from an allowed IP address.
 * Used for administrative endpoints that require additional security.
 *
 * Configuration:
 * - ADMIN_IP_WHITELIST: Comma-separated list of allowed IPs/CIDR ranges
 * - Example: "127.0.0.1,192.168.1.0/24,10.0.0.0/8"
 *
 * @example
 * ```typescript
 * @Controller('admin')
 * @UseGuards(JwtAuthGuard, RolesGuard, IpWhitelistGuard)
 * @Roles(Role.SUPER_ADMIN)
 * export class AdminController {
 *   // All endpoints require IP whitelist
 * }
 * ```
 */
@Injectable()
export class IpWhitelistGuard implements CanActivate {
  private readonly allowedIPs: Set<string>;
  private readonly cidrRanges: Array<{ network: string; prefix: number }>;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {
    const whitelistConfig = this.configService.get<string>('ADMIN_IP_WHITELIST', '');
    const { ips, cidrs } = this.parseWhitelist(whitelistConfig);
    this.allowedIPs = ips;
    this.cidrRanges = cidrs;

    // Log whitelist configuration (without exposing actual IPs in production)
    if (this.configService.isDevelopment()) {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        'IP whitelist guard initialized',
        'IpWhitelistGuard',
        {
          ipCount: this.allowedIPs.size,
          cidrCount: this.cidrRanges.length,
        }
      );
    }
  }

  /**
   * Parse whitelist configuration
   * Supports:
   * - Single IPs: "127.0.0.1"
   * - CIDR ranges: "192.168.1.0/24"
   * - Comma-separated: "127.0.0.1,192.168.1.0/24"
   */
  private parseWhitelist(config: string): {
    ips: Set<string>;
    cidrs: Array<{ network: string; prefix: number }>;
  } {
    const ips = new Set<string>();
    const cidrs: Array<{ network: string; prefix: number }> = [];

    if (!config || config.trim() === '') {
      // Empty whitelist means no restrictions (allow all)
      // In production, this should be configured
      return { ips, cidrs };
    }

    const entries = config
      .split(',')
      .map((entry: string) => entry.trim())
      .filter(Boolean);

    for (const entry of entries) {
      if (entry.includes('/')) {
        // CIDR notation
        const [network, prefixStr] = entry.split('/');
        if (!prefixStr) {
          continue;
        }
        const prefix = parseInt(prefixStr, 10);
        if (isNaN(prefix) || prefix < 0 || prefix > 128) {
          void this.loggingService.log(
            LogType.SECURITY,
            LogLevel.WARN,
            `Invalid CIDR prefix in whitelist: ${entry}`,
            'IpWhitelistGuard',
            { entry }
          );
          continue;
        }
        if (network) {
          cidrs.push({ network: network.trim(), prefix });
        }
      } else {
        // Single IP
        if (this.isValidIP(entry)) {
          ips.add(entry);
        } else {
          void this.loggingService.log(
            LogType.SECURITY,
            LogLevel.WARN,
            `Invalid IP in whitelist: ${entry}`,
            'IpWhitelistGuard',
            { entry }
          );
        }
      }
    }

    return { ips, cidrs };
  }

  /**
   * Validate IP address format
   */
  private isValidIP(ip: string): boolean {
    // IPv4 validation
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(ip)) {
      const parts = ip.split('.').map(Number);
      return parts.every((part: number) => part >= 0 && part <= 255);
    }

    // IPv6 validation (simplified)
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv6Regex.test(ip);
  }

  /**
   * Check if IP matches CIDR range
   */
  private isIPInCIDR(ip: string, network: string, prefix: number): boolean {
    try {
      const ipParts = ip.split('.').map(Number);
      const networkParts = network.split('.').map(Number);

      if (ipParts.length !== 4 || networkParts.length !== 4) {
        return false;
      }

      // Convert to binary and check prefix
      if (
        ipParts[0] === undefined ||
        ipParts[1] === undefined ||
        ipParts[2] === undefined ||
        ipParts[3] === undefined ||
        networkParts[0] === undefined ||
        networkParts[1] === undefined ||
        networkParts[2] === undefined ||
        networkParts[3] === undefined
      ) {
        return false;
      }
      const ipBinary = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
      const networkBinary =
        (networkParts[0] << 24) |
        (networkParts[1] << 16) |
        (networkParts[2] << 8) |
        networkParts[3];
      const mask = (0xffffffff << (32 - prefix)) >>> 0;

      return (ipBinary & mask) === (networkBinary & mask);
    } catch {
      return false;
    }
  }

  /**
   * Extract client IP from request
   */
  private getClientIP(request: FastifyRequest): string {
    // Check X-Forwarded-For header (for proxies/load balancers)
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = typeof forwardedFor === 'string' ? forwardedFor.split(',') : forwardedFor;
      // First IP in the chain is the original client
      return ips[0]?.trim() || '';
    }

    // Check X-Real-IP header
    const realIP = request.headers['x-real-ip'];
    if (realIP && typeof realIP === 'string') {
      return realIP.trim();
    }

    // Fallback to socket remote address
    return request.ip || request.socket?.remoteAddress || 'unknown';
  }

  /**
   * Check if IP is allowed
   */
  private isIPAllowed(ip: string): boolean {
    // If whitelist is empty, allow all (development mode)
    if (this.allowedIPs.size === 0 && this.cidrRanges.length === 0) {
      // In production, this should be configured
      // For now, allow if in development mode
      return this.configService.isDevelopment();
    }

    // Check exact IP match
    if (this.allowedIPs.has(ip)) {
      return true;
    }

    // Check CIDR ranges
    for (const { network, prefix } of this.cidrRanges) {
      if (this.isIPInCIDR(ip, network, prefix)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Guard activation
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const clientIP = this.getClientIP(request);

    if (clientIP === 'unknown') {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'Could not determine client IP for whitelist check',
        'IpWhitelistGuard',
        {
          headers: Object.keys(request.headers),
          url: request.url,
        }
      );
      // In development, allow if IP cannot be determined
      // In production, this should be more strict
      return this.configService.isDevelopment();
    }

    const isAllowed = this.isIPAllowed(clientIP);

    if (!isAllowed) {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'IP whitelist check failed',
        'IpWhitelistGuard',
        {
          clientIP,
          url: request.url,
          method: request.method,
        }
      );

      throw new ForbiddenException({
        message: 'Access denied: IP address not whitelisted',
        code: 'IP_WHITELIST_DENIED',
      });
    }

    return true;
  }
}
