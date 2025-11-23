import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';

export interface LogContext {
  [key: string]: any;
}

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: winston.Logger;
  private context?: string;

  constructor() {
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        isDevelopment
          ? winston.format.colorize()
          : winston.format.json(),
        winston.format.printf((info) => {
          if (isDevelopment) {
            const context = info.context ? `[${info.context}]` : '';
            const requestId = info.requestId ? `[${info.requestId}]` : '';
            return `${info.timestamp} ${info.level} ${context}${requestId} ${info.message}${info.stack ? '\n' + info.stack : ''}`;
          }
          // JSON format for production
          return JSON.stringify({
            timestamp: info.timestamp,
            level: info.level,
            context: info.context,
            requestId: info.requestId,
            message: info.message,
            ...(info.metadata && typeof info.metadata === 'object' ? info.metadata : {}),
            ...(info.stack && { stack: info.stack }),
          });
        }),
      ),
      transports: [
        new winston.transports.Console({
          handleExceptions: true,
          handleRejections: true,
        }),
      ],
    });
  }

  setContext(context: string) {
    this.context = context;
  }

  log(message: string, context?: string | LogContext, metadata?: LogContext) {
    const ctx = typeof context === 'string' ? context : this.context;
    const meta = typeof context === 'object' ? context : metadata;
    this.logger.info(message, { context: ctx, ...meta });
  }

  error(message: string, trace?: string, context?: string | LogContext, metadata?: LogContext) {
    const ctx = typeof context === 'string' ? context : this.context;
    const meta = typeof context === 'object' ? context : metadata;
    this.logger.error(message, {
      context: ctx,
      stack: trace,
      ...meta,
    });
  }

  warn(message: string, context?: string | LogContext, metadata?: LogContext) {
    const ctx = typeof context === 'string' ? context : this.context;
    const meta = typeof context === 'object' ? context : metadata;
    this.logger.warn(message, { context: ctx, ...meta });
  }

  debug(message: string, context?: string | LogContext, metadata?: LogContext) {
    const ctx = typeof context === 'string' ? context : this.context;
    const meta = typeof context === 'object' ? context : metadata;
    this.logger.debug(message, { context: ctx, ...meta });
  }

  verbose(message: string, context?: string | LogContext, metadata?: LogContext) {
    const ctx = typeof context === 'string' ? context : this.context;
    const meta = typeof context === 'object' ? context : metadata;
    this.logger.verbose(message, { context: ctx, ...meta });
  }

  /**
   * Log with structured context
   */
  logWithContext(level: 'info' | 'warn' | 'error' | 'debug', message: string, context: LogContext) {
    const ctx = this.context || context.context || 'Application';
    this.logger[level](message, { context: ctx, ...context });
  }
}

