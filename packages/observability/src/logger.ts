import type { LoggerService } from '@nestjs/common';
import { readEnv } from '@quorumloop/config';
import pino, { type Logger } from 'pino';
import { currentContext } from './context';
import { redactSecrets } from './redact';

export type ServiceLogger = Logger;

export interface LoggerOptions {
  service: string;
  level?: string;
}

/**
 * Structured JSON logs. Pretty printing is deliberately not enabled anywhere: the same line
 * shape must survive from a laptop to a container collector.
 */
export const createLogger = (options: LoggerOptions): Logger =>
  pino({
    level: options.level ?? readEnv().LOG_LEVEL,
    base: { service: options.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        '*.password',
        '*.token',
        '*.secret',
        '*.access_token',
        '*.refresh_token',
        '*.private_key',
      ],
      censor: '[redacted]',
    },
    mixin: () => {
      const context = currentContext();
      if (!context) {
        return {};
      }
      return {
        correlation_id: context.correlationId,
        org_id: context.orgId,
        user_id: context.userId,
      };
    },
  });

const stringify = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** Bridges Nest's LoggerService into the same structured stream as business logs. */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  private write(
    level: 'info' | 'warn' | 'error' | 'debug' | 'trace',
    message: unknown,
    context?: string,
  ): void {
    this.logger[level]({ context: context ?? 'nest' }, redactSecrets(stringify(message)));
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.logger.error({ context: context ?? 'nest', stack }, redactSecrets(stringify(message)));
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }
}
