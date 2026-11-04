import { DomainError, errorResponse, type ErrorCode } from '@quorumloop/contracts';
import { correlationId } from '@quorumloop/observability';
import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  PRECONDITION_FAILED: HttpStatus.PRECONDITION_FAILED,
  POLICY_DENIED: HttpStatus.FORBIDDEN,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  UPSTREAM_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  NOT_CONFIGURED: HttpStatus.CONFLICT,
  UNSUPPORTED_CAPABILITY: HttpStatus.UNPROCESSABLE_ENTITY,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

const CODE_BY_STATUS = (status: number): ErrorCode => {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_FAILED';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.PRECONDITION_FAILED:
      return 'PRECONDITION_FAILED';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'UPSTREAM_UNAVAILABLE';
    default:
      return 'INTERNAL';
  }
};

/**
 * One error shape for every service. Stacks and provider messages stay in the log; the client
 * receives a stable code, a safe message, the correlation id and a retry hint.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly service: string,
    private readonly logger: Logger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<{ url: string; method: string }>();
    const correlation = correlationId();

    let code: ErrorCode = 'INTERNAL';
    let message = 'the service could not complete the request';
    let retryable = false;
    let details: Record<string, unknown> | undefined;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof DomainError) {
      code = exception.code;
      message = exception.message;
      retryable = exception.retryable;
      details = exception.details;
      status = STATUS_BY_CODE[code];
    } else if (exception instanceof ZodError) {
      code = 'VALIDATION_FAILED';
      message = 'request validation failed';
      status = HttpStatus.BAD_REQUEST;
      details = {
        issues: exception.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS(status);
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object' && 'message' in response) {
        const value = (response as { message: unknown }).message;
        message = Array.isArray(value) ? value.join('; ') : String(value);
      } else {
        message = exception.message;
      }
    }

    if (status >= 500) {
      this.logger.error(
        {
          service: this.service,
          method: request.method,
          url: request.url,
          err: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        },
        'request failed',
      );
    } else {
      this.logger.warn(
        { service: this.service, method: request.method, url: request.url, code },
        'request rejected',
      );
    }

    if (reply.sent) {
      return;
    }
    reply.status(status).send(errorResponse(code, message, correlation, retryable, details));
  }
}
