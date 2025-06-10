export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
  VERBOSE = 'VERBOSE'
}

export enum LogType {
  SYSTEM = 'SYSTEM',
  AUTH = 'AUTH',
  ERROR = 'ERROR',
  REQUEST = 'REQUEST',
  RESPONSE = 'RESPONSE',
  WEBSOCKET = 'WEBSOCKET',
  DATABASE = 'DATABASE',
  CACHE = 'CACHE',
  QUEUE = 'QUEUE',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  NOTIFICATION = 'NOTIFICATION',
  AUDIT = 'AUDIT',
  PERFORMANCE = 'PERFORMANCE',
  SECURITY = 'SECURITY',
  APPOINTMENT = 'APPOINTMENT',
  USER = 'USER',
  CLINIC = 'CLINIC',
  EVENT = 'EVENT'
}

export interface LogEntry {
  type: LogType;
  level: LogLevel;
  message: string;
  context: string;
  metadata?: Record<string, any>;
  timestamp: Date;
} 