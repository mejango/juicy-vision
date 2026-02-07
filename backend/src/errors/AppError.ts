/**
 * Structured Error Types
 *
 * Provides consistent error handling across the application with:
 * - Unique error codes for programmatic handling
 * - Appropriate HTTP status codes
 * - Optional metadata for debugging
 */

/**
 * Base application error with code, message, and status
 */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    // Maintains proper stack trace for where error was thrown (V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON(): {
    error: string;
    message: string;
    metadata?: Record<string, unknown>;
  } {
    return {
      error: this.code,
      message: this.message,
      ...(this.metadata && { metadata: this.metadata }),
    };
  }
}

/**
 * Rate limit exceeded error (429)
 */
export class RateLimitError extends AppError {
  constructor(message: string, retryAfter?: number) {
    super('RATE_LIMIT_EXCEEDED', message, 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

/**
 * Authentication required error (401)
 */
export class AuthError extends AppError {
  constructor(message: string = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'AuthError';
  }
}

/**
 * Permission denied error (403)
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * Resource not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} '${identifier}' not found`
      : `${resource} not found`;
    super('NOT_FOUND', message, 404, { resource, identifier });
    this.name = 'NotFoundError';
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, fields?: Record<string, string>) {
    super('VALIDATION_ERROR', message, 400, { fields });
    this.name = 'ValidationError';
  }
}

/**
 * Conflict error (409) - e.g., duplicate resource
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

/**
 * External service error (502)
 */
export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super('EXTERNAL_SERVICE_ERROR', `${service}: ${message}`, 502, { service });
    this.name = 'ExternalServiceError';
  }
}

/**
 * Circuit breaker open error (503)
 */
export class CircuitBreakerError extends AppError {
  constructor(service: string) {
    super(
      'SERVICE_UNAVAILABLE',
      `Service temporarily unavailable: ${service}`,
      503,
      { service }
    );
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Insufficient balance error (402)
 */
export class InsufficientBalanceError extends AppError {
  constructor(
    resource: string,
    required?: string,
    available?: string
  ) {
    super(
      'INSUFFICIENT_BALANCE',
      `Insufficient ${resource} balance`,
      402,
      { resource, required, available }
    );
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
