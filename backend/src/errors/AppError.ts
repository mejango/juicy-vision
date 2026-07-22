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
    public metadata?: Record<string, unknown>,
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
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
