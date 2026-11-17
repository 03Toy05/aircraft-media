/** Errors whose message is safe to show to the user. */
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (what: string) => new DomainError("NOT_FOUND", `${what} not found`);
export const invalid = (message: string, details?: unknown) => new DomainError("INVALID", message, details);
export const conflict = (code: string, message: string, details?: unknown) => new DomainError(code, message, details);
