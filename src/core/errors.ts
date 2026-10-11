export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INSUFFICIENT_STOCK"
  | "CREDIT_LIMIT"
  | "INVALID_STATE"
  | "FEATURE_DISABLED"
  | "DATABASE"
  | "INTERNAL"

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = "AppError"
  }
}
