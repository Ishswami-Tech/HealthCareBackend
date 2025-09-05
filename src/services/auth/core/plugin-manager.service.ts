import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../libs/infrastructure/cache';
import { CircuitBreakerService } from '../../../libs/core/resilience';
import { 
  IAuthPlugin, 
  AuthPluginDomain, 
  AuthPluginContext, 
  AuthPluginMetadata,
  LoginRequest,
  RegisterRequest,
  OTPRequest,
  PasswordResetRequest,
  MagicLinkRequest
} from './auth-plugin.interface';
import { 
  AuthResponse, 
  OTPResult, 
  PasswordResetResult, 
  MagicLinkResult, 
  AuthTokens 
} from '../../../libs/core/types';

// Enhanced error types for better error handling
export class PluginExecutionError extends Error {
  constructor(
    message: string,
    public plugin: string,
    public operation: string,
    public context: AuthPluginContext,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'PluginExecutionError';
  }
}

export class PluginNotFoundError extends Error {
  constructor(
    message: string,
    public domain: AuthPluginDomain,
    public operation?: string
  ) {
    super(message);
    this.name = 'PluginNotFoundError';
  }
}

export class RateLimitExceededError extends Error {
  constructor(
    message: string,
    public pluginKey: string,
    public operation: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'RateLimitExceededError';
  }
}

export class PluginTimeoutError extends Error {
  constructor(
    message: string,
    public plugin: string,
    public operation: string,
    public timeout: number
  ) {
    super(message);
    this.name = 'PluginTimeoutError';
  }
}

export interface PluginManagerConfig {
  enableHotSwapping: boolean;
  pluginCacheTimeout: number;
  defaultDomain: AuthPluginDomain;
  enableMetrics: boolean;
  enableCircuitBreaker: boolean;
  maxPluginExecutionTime: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

export interface PluginMetrics {
      totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  lastUsed: Date;
  errorRate: number;
  circuitBreakerState?: string;
}

export interface PluginHealthStatus {
  pluginName: string;
  domain: AuthPluginDomain;
  healthy: boolean;
  responseTime: number;
  errorCount: number;
  lastHealthCheck: Date;
  details?: Record<string, any>;
}

@Injectable()
export class PluginManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginManagerService.name);
  private readonly plugins = new Map<string, IAuthPlugin>();
  private readonly pluginsByDomain = new Map<AuthPluginDomain, IAuthPlugin[]>();
  private readonly pluginMetrics = new Map<string, PluginMetrics>();
  private readonly pluginHealth = new Map<string, PluginHealthStatus>();
  private readonly config: PluginManagerConfig;
  private metricsInterval!: NodeJS.Timeout;
  private healthCheckInterval!: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {
    this.config = {
      enableHotSwapping: this.configService.get<boolean>('AUTH_PLUGIN_HOT_SWAPPING') || false,
      pluginCacheTimeout: this.configService.get<number>('AUTH_PLUGIN_CACHE_TIMEOUT') || 300,
      defaultDomain: this.configService.get<AuthPluginDomain>('AUTH_DEFAULT_DOMAIN') || AuthPluginDomain.CLINIC,
      enableMetrics: this.configService.get<boolean>('AUTH_PLUGIN_METRICS') || true,
      enableCircuitBreaker: this.configService.get<boolean>('AUTH_PLUGIN_CIRCUIT_BREAKER') || true,
      maxPluginExecutionTime: this.configService.get<number>('AUTH_PLUGIN_MAX_EXECUTION_TIME') || 5000,
      rateLimitWindowMs: this.configService.get<number>('AUTH_PLUGIN_RATE_LIMIT_WINDOW') || 60000,
      rateLimitMaxRequests: this.configService.get<number>('AUTH_PLUGIN_RATE_LIMIT_MAX') || 1000,
    };
  }

  async onModuleInit() {
    this.logger.log('🚀 Initializing Plugin Manager Service...');
    
    // Initialize core plugin metadata (plugins will be registered by modules)
    await this.initializeCorePlugins();
    
    if (this.config.enableMetrics) {
      this.startMetricsCollection();
    }
    
    this.startHealthChecking();
    this.logger.log('✅ Plugin Manager Service initialized successfully');
  }

  private async initializeCorePlugins(): Promise<void> {
    try {
      // Register core plugins with mock data since we can't inject them
      // In a real implementation, these would be discovered dynamically
      const corePlugins = [
        {
          name: 'clinic-auth',
          version: '1.0.0',
          domain: 'CLINIC' as any,
          capabilities: {
            supportsOTP: true,
            supportsMagicLink: true,
            supportsPasswordAuth: true,
            supportsSocialAuth: true,
            supportsBiometric: false,
            supports2FA: true,
            requiresEmailVerification: true,
            requiresPhoneVerification: true,
            supportsMultipleTenants: true,
          }
        },
        {
          name: 'shared-auth',
          version: '1.0.0',
          domain: 'SHARED' as any,
          capabilities: {
            supportsOTP: true,
            supportsMagicLink: true,
            supportsPasswordAuth: false,
            supportsSocialAuth: true,
            supportsBiometric: true,
            supports2FA: true,
            requiresEmailVerification: true,
            requiresPhoneVerification: true,
            supportsMultipleTenants: false,
          }
        }
      ];

      for (const pluginInfo of corePlugins) {
        // Initialize plugin metrics without actual plugin instance
        this.initializePluginMetrics(`${pluginInfo.domain}:${pluginInfo.name}`);
        this.logger.log(`Core plugin initialized: ${pluginInfo.name}`);
      }
    } catch (error) {
      this.logger.error('Failed to initialize core plugins:', error);
    }
  }

  private initializePluginMetrics(pluginKey: string): void {
    this.pluginMetrics.set(pluginKey, {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      lastUsed: new Date(),
      errorRate: 0,
    });
  }

  async onModuleDestroy() {
    this.logger.log('🔧 Shutting down Plugin Manager Service...');
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    // Cleanup all plugins
    for (const plugin of this.plugins.values()) {
      try {
        if (plugin.destroy) {
          await plugin.destroy();
        }
      } catch (error) {
        this.logger.error(`Error destroying plugin ${plugin.name}:`, error);
      }
    }
    
    this.logger.log('✅ Plugin Manager Service shutdown completed');
  }

  // =============================================
  // PLUGIN REGISTRATION & MANAGEMENT
  // =============================================

  async registerPlugin(plugin: IAuthPlugin): Promise<void> {
    try {
      const key = this.getPluginKey(plugin.domain, plugin.name);
      
      if (plugin.initialize) {
        await plugin.initialize(this.getPluginConfig(plugin.name));
      }

      this.plugins.set(key, plugin);
      
      if (!this.pluginsByDomain.has(plugin.domain)) {
        this.pluginsByDomain.set(plugin.domain, []);
      }
      this.pluginsByDomain.get(plugin.domain)!.push(plugin);

      this.pluginMetrics.set(key, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        lastUsed: new Date(),
        errorRate: 0,
      });

      await this.cachePluginMetadata(plugin);

      this.logger.log(`Plugin registered: ${plugin.name} (${plugin.domain}) v${plugin.version}`);
    } catch (error) {
      this.logger.error(`Failed to register plugin ${plugin.name}:`, error);
      throw error;
    }
  }

  getPlugin(domain: AuthPluginDomain, name?: string): IAuthPlugin | null {
    if (name) {
      const key = this.getPluginKey(domain, name);
      return this.plugins.get(key) || null;
    }

    const domainPlugins = this.pluginsByDomain.get(domain);
    return domainPlugins && domainPlugins.length > 0 ? domainPlugins[0] : null;
  }

  private getPluginFromContext(context: AuthPluginContext): IAuthPlugin | null {
    const plugin = this.getPlugin(context.domain);
    if (!plugin) {
      this.logger.error(`No plugin found for domain: ${context.domain}`);
    }
    return plugin;
  }

  // =============================================
  // AUTHENTICATION OPERATIONS WITH PLUGIN ROUTING
  // =============================================

  async validateUser(email: string, password: string, context: AuthPluginContext): Promise<any | null> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin) return null;

    return this.executeWithResilience(
      plugin,
      'validateUser',
      () => plugin.validateUser(email, password, context),
      context
    );
  }

  async login(request: LoginRequest): Promise<AuthResponse> {
    const plugin = this.getPluginFromContext(request.context);
    if (!plugin) {
      throw new PluginNotFoundError(
        `No plugin available for domain: ${request.context.domain}`,
        request.context.domain,
        'login'
      );
    }

    return this.executeWithResilience(
      plugin,
      'login',
      () => plugin.login(request),
      request.context
    );
  }

  async register(request: RegisterRequest): Promise<AuthResponse> {
    const plugin = this.getPluginFromContext(request.context);
    if (!plugin) {
      throw new PluginNotFoundError(
        `No plugin available for domain: ${request.context.domain}`,
        request.context.domain,
        'register'
      );
    }

    return this.executeWithResilience(
      plugin,
      'register',
      () => plugin.register(request),
      request.context
    );
  }

  async logout(userId: string, sessionId: string | undefined, context: AuthPluginContext): Promise<{ success: boolean; message?: string }> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin) {
      return { success: false, message: `No plugin available for domain: ${context.domain}` };
    }

    return this.executeWithResilience(
      plugin,
      'logout',
      () => plugin.logout(userId, sessionId, context),
      context
    );
  }

  async verifyToken(token: string, context: AuthPluginContext): Promise<any | null> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin) return null;

    return this.executeWithResilience(
      plugin,
      'verifyToken',
      () => plugin.verifyToken(token, context),
      context
    );
  }

  // =============================================
  // OTP OPERATIONS
  // =============================================

  async requestOTP(request: OTPRequest): Promise<OTPResult> {
    const plugin = this.getPluginFromContext(request.context);
    if (!plugin || !plugin.requestOTP) {
      throw new PluginNotFoundError(
        `OTP not supported for domain: ${request.context.domain}`,
        request.context.domain,
        'requestOTP'
      );
    }

    return this.executeWithResilience(
      plugin,
      'requestOTP',
      () => plugin.requestOTP!(request),
      request.context
    );
  }

  async verifyOTP(identifier: string, otp: string, context: AuthPluginContext): Promise<{ success: boolean; user?: any; error?: string }> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin || !plugin.verifyOTP) {
      return { success: false, error: `OTP not supported for domain: ${context.domain}` };
    }

    return this.executeWithResilience(
      plugin,
      'verifyOTP',
      () => plugin.verifyOTP!(identifier, otp, context),
      context
    );
  }

  // =============================================
  // PASSWORD OPERATIONS
  // =============================================

  async forgotPassword(request: PasswordResetRequest): Promise<PasswordResetResult> {
    const plugin = this.getPluginFromContext(request.context);
    if (!plugin || !plugin.forgotPassword) {
      throw new PluginNotFoundError(
        `Password reset not supported for domain: ${request.context.domain}`,
        request.context.domain,
        'forgotPassword'
      );
    }

    return this.executeWithResilience(
      plugin,
      'forgotPassword',
      () => plugin.forgotPassword!(request),
      request.context
    );
  }

  async resetPassword(request: PasswordResetRequest): Promise<PasswordResetResult> {
    const plugin = this.getPluginFromContext(request.context);
    if (!plugin || !plugin.resetPassword) {
      throw new PluginNotFoundError(
        `Password reset not supported for domain: ${request.context.domain}`,
        request.context.domain,
        'resetPassword'
      );
    }

    return this.executeWithResilience(
      plugin,
      'resetPassword',
      () => plugin.resetPassword!(request),
      request.context
    );
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: AuthPluginContext
  ): Promise<{ success: boolean; error?: string }> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin || !plugin.changePassword) {
      return { success: false, error: `Password change not supported for domain: ${context.domain}` };
    }

    return this.executeWithResilience(
      plugin,
      'changePassword',
      () => plugin.changePassword!(userId, currentPassword, newPassword, context),
      context
    );
  }

  // =============================================
  // MAGIC LINK OPERATIONS
  // =============================================

  async sendMagicLink(request: MagicLinkRequest): Promise<MagicLinkResult> {
    const plugin = this.getPluginFromContext(request.context);
    if (!plugin || !plugin.sendMagicLink) {
      return { 
        success: false, 
        message: `Magic link not supported for domain: ${request.context.domain}` 
      };
    }

    return this.executeWithResilience(
      plugin,
      'sendMagicLink',
      () => plugin.sendMagicLink!(request),
      request.context
    );
  }

  async verifyMagicLink(token: string, context: AuthPluginContext): Promise<AuthResponse | null> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin || !plugin.verifyMagicLink) {
      return null;
    }

    return this.executeWithResilience(
      plugin,
      'verifyMagicLink',
      () => plugin.verifyMagicLink!(token, context),
      context
    );
  }

  // =============================================
  // TOKEN OPERATIONS
  // =============================================

  async refreshTokens(refreshToken: string, context: AuthPluginContext): Promise<AuthTokens> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin || !plugin.refreshTokens) {
      throw new PluginNotFoundError(
        `Token refresh not supported for domain: ${context.domain}`,
        context.domain,
        'refreshTokens'
      );
    }

    return this.executeWithResilience(
      plugin,
      'refreshTokens',
      () => plugin.refreshTokens!(refreshToken, context),
      context
    );
  }

  // =============================================
  // SOCIAL AUTH OPERATIONS
  // =============================================

  async handleGoogleAuth(token: string, context: AuthPluginContext): Promise<AuthResponse> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin || !plugin.handleGoogleAuth) {
      throw new PluginNotFoundError(
        `Google auth not supported for domain: ${context.domain}`,
        context.domain,
        'handleGoogleAuth'
      );
    }

    return this.executeWithResilience(
      plugin,
      'handleGoogleAuth',
      () => plugin.handleGoogleAuth!(token, context),
      context
    );
  }

  async handleFacebookAuth(token: string, context: AuthPluginContext): Promise<AuthResponse> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin || !plugin.handleFacebookAuth) {
      throw new PluginNotFoundError(
        `Facebook auth not supported for domain: ${context.domain}`,
        context.domain,
        'handleFacebookAuth'
      );
    }

    return this.executeWithResilience(
      plugin,
      'handleFacebookAuth',
      () => plugin.handleFacebookAuth!(token, context),
      context
    );
  }

  async handleAppleAuth(token: string, context: AuthPluginContext): Promise<AuthResponse> {
    const plugin = this.getPluginFromContext(context);
    if (!plugin || !plugin.handleAppleAuth) {
      throw new PluginNotFoundError(
        `Apple auth not supported for domain: ${context.domain}`,
        context.domain,
        'handleAppleAuth'
      );
    }

    return this.executeWithResilience(
      plugin,
      'handleAppleAuth',
      () => plugin.handleAppleAuth!(token, context),
      context
    );
  }

  // =============================================
  // RESILIENCE & EXECUTION WRAPPER
  // =============================================

  private async executeWithResilience<T>(
    plugin: IAuthPlugin,
    operation: string,
    fn: () => Promise<T>,
    context: AuthPluginContext
  ): Promise<T> {
    const pluginKey = this.getPluginKey(plugin.domain, plugin.name);
    const startTime = Date.now();

    try {
      await this.checkRateLimit(pluginKey, operation, context);

      let result: T;

      if (this.config.enableCircuitBreaker) {
        result = await this.circuitBreakerService.execute(
          fn,
          {
            name: `auth.plugin.${pluginKey}.${operation}`,
            failureThreshold: 5,
            recoveryTimeout: 30000,
          }
        );
      } else {
        result = await Promise.race([
          fn(),
          this.createTimeoutPromise(this.config.maxPluginExecutionTime)
        ]);
      }

      const duration = Date.now() - startTime;
      await this.updatePluginMetrics(pluginKey, true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.updatePluginMetrics(pluginKey, false, duration);

      this.logger.error(
        `Plugin execution failed: ${plugin.name}.${operation}`,
        {
          plugin: plugin.name,
          domain: plugin.domain,
          operation,
          error: error instanceof Error ? (error as Error).message : String(error),
          duration,
          context: {
            domain: context.domain,
            tenantId: context.tenantId,
          },
        }
      );

      throw error;
    }
  }

  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new PluginTimeoutError('Plugin execution timeout', 'unknown', 'unknown', timeout)), timeout);
    });
  }

  // =============================================
  // RATE LIMITING
  // =============================================

  private async checkRateLimit(pluginKey: string, operation: string, context: AuthPluginContext): Promise<void> {
    const rateLimitKey = `auth:rate-limit:${pluginKey}:${operation}:${context.tenantId || 'global'}`;
    
    try {
      const currentCount = await this.cacheService.get<number>(rateLimitKey) || 0;
      
      if (currentCount >= this.config.rateLimitMaxRequests) {
        throw new RateLimitExceededError(
          `Rate limit exceeded for plugin ${pluginKey}.${operation}`,
          pluginKey,
          operation,
          this.config.rateLimitWindowMs / 1000
        );
      }
      
      await this.cacheService.set(rateLimitKey, currentCount + 1, this.config.rateLimitWindowMs / 1000);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw error;
      }
      this.logger.warn('Rate limit check failed:', error instanceof Error ? (error as Error).message : String(error));
    }
  }

  // =============================================
  // METRICS & MONITORING
  // =============================================

  private async updatePluginMetrics(pluginKey: string, success: boolean, duration: number): Promise<void> {
    if (!this.config.enableMetrics) return;

    try {
      const metrics = this.pluginMetrics.get(pluginKey);
      if (!metrics) return;

      metrics.totalRequests++;
      metrics.lastUsed = new Date();
      
      if (success) {
        metrics.successfulRequests++;
      } else {
        metrics.failedRequests++;
      }

      metrics.averageResponseTime = metrics.averageResponseTime === 0 
        ? duration 
        : (metrics.averageResponseTime * 0.9) + (duration * 0.1);

      metrics.errorRate = (metrics.failedRequests / metrics.totalRequests) * 100;

      // Circuit breaker state information could be added here if needed
      // metrics.circuitBreakerState = 'unknown';

      this.pluginMetrics.set(pluginKey, metrics);
    } catch (error) {
      this.logger.debug('Error updating plugin metrics:', error);
    }
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        await this.persistMetrics();
      } catch (error) {
        this.logger.debug('Error persisting plugin metrics:', error);
      }
    }, 60000); // Every minute
  }

  private async persistMetrics(): Promise<void> {
    const allMetrics: Record<string, PluginMetrics> = {};
    
    for (const [key, metrics] of this.pluginMetrics) {
      allMetrics[key] = { ...metrics };
    }

    await this.cacheService.set('auth:plugin:metrics', allMetrics, 3600);
  }

  // =============================================
  // HEALTH CHECKING
  // =============================================

  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 30000); // Every 30 seconds
  }

  private async performHealthChecks(): Promise<void> {
    const healthChecks = Array.from(this.plugins.entries()).map(async ([key, plugin]) => {
      try {
        const startTime = Date.now();
        
          let health: { healthy: boolean; details?: any; errors?: string[] } = { healthy: false };
        if (plugin.healthCheck) {
          health = await plugin.healthCheck();
        }

        const responseTime = Date.now() - startTime;
        const metrics = this.pluginMetrics.get(key);

        this.pluginHealth.set(key, {
          pluginName: plugin.name,
          domain: plugin.domain,
          healthy: health.healthy,
          responseTime,
          errorCount: metrics?.failedRequests || 0,
          lastHealthCheck: new Date(),
          details: health.details,
        });
      } catch (error) {
        this.pluginHealth.set(key, {
          pluginName: plugin.name,
          domain: plugin.domain,
          healthy: false,
          responseTime: -1,
          errorCount: -1,
          lastHealthCheck: new Date(),
          details: { error: error instanceof Error ? (error as Error).message : String(error) },
        });
      }
    });

    await Promise.all(healthChecks);
  }

  async getPluginHealth(): Promise<PluginHealthStatus[]> {
    return Array.from(this.pluginHealth.values());
  }

  async getPluginMetrics(): Promise<Record<string, PluginMetrics>> {
    const metrics: Record<string, PluginMetrics> = {};
    for (const [key, value] of this.pluginMetrics) {
      metrics[key] = { ...value };
    }
    return metrics;
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  private getPluginKey(domain: AuthPluginDomain, name: string): string {
    return `${domain}:${name}`;
  }

  private getPluginConfig(pluginName: string): Record<string, any> {
    return this.configService.get(`AUTH_PLUGIN_${pluginName.toUpperCase()}`) || {};
  }

  private async cachePluginMetadata(plugin: IAuthPlugin): Promise<void> {
    try {
      const metadata: AuthPluginMetadata = {
        name: plugin.name,
        version: plugin.version,
        domain: plugin.domain,
        description: `Authentication plugin for ${plugin.domain}`,
      };

      const key = `auth:plugin:metadata:${this.getPluginKey(plugin.domain, plugin.name)}`;
      await this.cacheService.set(key, metadata, this.config.pluginCacheTimeout);
    } catch (error) {
      this.logger.debug('Error caching plugin metadata:', error);
    }
  }

  async getAllPluginMetadata(): Promise<AuthPluginMetadata[]> {
    const metadata: AuthPluginMetadata[] = [];
    
    for (const plugin of this.plugins.values()) {
      metadata.push({
        name: plugin.name,
        version: plugin.version,
        domain: plugin.domain,
        description: `Authentication plugin for ${plugin.domain}`,
      });
    }

    return metadata;
  }

  getPluginCapabilities(domain: AuthPluginDomain): any {
    const plugin = this.getPlugin(domain);
    return plugin?.capabilities || {};
  }
}