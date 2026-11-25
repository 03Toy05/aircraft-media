/**
 * Errors whose message is safe to show to the user. The message is written as an English template with {placeholders}
 * (params fill them), so the screen can show it in the user's language: see errorText in uiText.ts. `message` is the
 * filled-in English, as before.
 */
export class DomainError extends Error {
  /** The English wording with {placeholders}, the key for translating it. */
  public template: string;
  constructor(
    public code: string,
    template: string,
    public details?: unknown,
    public params: Record<string, string | number> = {},
  ) {
    super(template.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] === undefined ? m : String(params[k]))));
    this.template = template;
    this.name = "DomainError";
  }
}

/** "Operator not found": `what` is an English noun, translated too when shown. */
export const notFound = (what: string) => new DomainError("NOT_FOUND", "{what} not found", undefined, { what });
export const invalid = (message: string, details?: unknown, params?: Record<string, string | number>) => new DomainError("INVALID", message, details, params);
export const conflict = (code: string, message: string, details?: unknown, params?: Record<string, string | number>) => new DomainError(code, message, details, params);
