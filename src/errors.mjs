export class AppError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}
export function safeError(error) {
  return error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'The service could not complete this request.', 500, true);
}
export function errorBody(error, requestId) {
  const e = safeError(error);
  return { error: { code: e.code, message: e.message, retryable: e.retryable }, request_id: requestId };
}
