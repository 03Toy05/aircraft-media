/**
 * Sends an email through Resend (https://resend.com), using RESEND_API_KEY and EMAIL_FROM from the environment
 * (e.g. EMAIL_FROM="Aircraft Media <sign-in@your-domain.com>", on a domain verified in Resend).
 * Not set up: in local development the email is printed to the server log instead; in production it fails.
 */
export function mailReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.RESEND_API_KEY && !!env.EMAIL_FROM;
}

export async function sendMail(msg: { to: string; subject: string; text: string; html: string }): Promise<void> {
  if (!mailReady()) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[mail not set up: would send to ${msg.to}] ${msg.subject}\n${msg.text}`);
      return;
    }
    throw new Error("Email is not set up (RESEND_API_KEY and EMAIL_FROM).");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!res.ok) throw new Error(`Email not sent (${res.status}).`);
}
