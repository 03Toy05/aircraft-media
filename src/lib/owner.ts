/** Single-owner access rule, kept free of framework imports so it is unit-testable. */
export function isOwnerEmail(email: string | null | undefined, ownerEmail = process.env.OWNER_EMAIL): boolean {
  if (!email || !ownerEmail) return false;
  return email.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
}

/** Local-development bypass. Never active in production. */
export function devBypassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.DEV_AUTH_BYPASS === "1";
}

/** E.164 digits only (no "+"), 8-15 digits. Returns null when it cannot be a phone number. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
