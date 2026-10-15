/**
 * A small typed error hierarchy. Controllers/services throw these; a single
 * error-handling boundary translates them into consistent HTTP responses.
 * This keeps "what went wrong" separate from "how it is rendered".
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  static validation(message = 'Request validation failed', details?: unknown) {
    return new ApiError('VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError('UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError('NOT_FOUND', message);
  }
  static conflict(message = 'Resource conflict', details?: unknown) {
    return new ApiError('CONFLICT', message, details);
  }
  static rateLimited(message = 'Too many requests') {
    return new ApiError('RATE_LIMITED', message);
  }
  static aiUnavailable(message = 'AI service is temporarily unavailable') {
    return new ApiError('AI_UNAVAILABLE', message);
  }
}
