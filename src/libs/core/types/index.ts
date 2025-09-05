// Core types for the healthcare application
export interface AuthResponse {
  success: boolean;
  user?: any;
  tokens?: AuthTokens;
  session_id?: string;
  sessionId?: string;
  message?: string;
  error?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
  tokenType?: string;
}

export interface OTPResult {
  success: boolean;
  message: string;
  expiresIn?: number;
  method?: 'sms' | 'email';
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role?: string;
  clinicId?: string;
  phone?: string;
  avatar?: string;
  lastLogin?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PasswordResetResult {
  success: boolean;
  message: string;
  token?: string;
}

export interface MagicLinkResult {
  success: boolean;
  message: string;
  linkId?: string;
  linkSent?: boolean;
  expiresIn?: number;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  clinicId?: string;
  domain?: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivity: Date;
  userAgent?: string;
  ipAddress?: string;
  metadata?: Record<string, any>;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  clinicId?: string;
  domain?: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

export interface DomainValidationResult {
  isValid: boolean;
  message?: string;
  errors?: string[];
  metadata?: Record<string, any>;
}

// Health Check Types
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  environment: string;
  version: string;
  systemMetrics: SystemMetrics;
  services: Record<string, ServiceHealth>;
}

export interface DetailedHealthCheckResponse extends HealthCheckResponse {
  processInfo: ProcessInfo;
  memory: MemoryInfo;
  cpu: CpuInfo;
}

export interface ServiceHealth {
  status: 'healthy' | 'unhealthy';
  details?: string;
  error?: string;
  responseTime: number;
  lastChecked: string;
  metrics?: Record<string, any>;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: {
    heapTotal: number;
    heapUsed: number;
    rss: number;
    external: number;
    systemTotal: number;
    systemFree: number;
    systemUsed: number;
  };
  cpuUsage: {
    user: number;
    system: number;
    cpuCount: number;
    cpuModel: string;
    cpuSpeed: number;
  };
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  platform: string;
  versions: Record<string, string>;
}

export interface MemoryInfo {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

export interface CpuInfo {
  user: number;
  system: number;
}