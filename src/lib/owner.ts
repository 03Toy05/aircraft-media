/**
 * The platform admins: OWNER_EMAIL, plus anyone in ADMIN_EMAILS (comma-separated, e.g. toy@aircraftmedia.my). They
 * share the owner's workspace and can manage users, the library and applications. Kept free of framework imports.
 */
export function isOwnerEmail(email: string | null | undefined, ownerEmail = process.env.OWNER_EMAIL, adminEmails = process.env.ADMIN_EMAILS): boolean {
  if (!email || !ownerEmail) return false;
  const e = email.trim().toLowerCase();
  return [ownerEmail, ...(adminEmails ?? "").split(",")].map((x) => x.trim().toLowerCase()).filter(Boolean).includes(e);
}

/**
 * The platform's own address, for everything between users and the admins: support messages, new applications,
 * and replies to the app's emails. SUPPORT_EMAIL (toy@aircraftmedia.my), else OWNER_EMAIL.
 */
export function supportEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.SUPPORT_EMAIL?.trim() || env.OWNER_EMAIL?.trim() || null;
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
