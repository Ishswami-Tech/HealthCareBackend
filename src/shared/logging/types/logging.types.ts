export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export enum LogType {
  AUTH = 'AUTH',
  APPOINTMENT = 'APPOINTMENT',
  USER = 'USER',
  SYSTEM = 'SYSTEM',
  SECURITY = 'SECURITY',
  ERROR = 'ERROR',
}

export interface LogEntry {
  type: LogType;
  level: LogLevel;
  message: string;
  context: string;
  metadata?: Record<string, any>;
  timestamp: Date;
} 