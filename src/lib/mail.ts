/**
 * Sends an email through Resend (https://resend.com), using RESEND_API_KEY and EMAIL_FROM from the environment
 * (e.g. EMAIL_FROM="Aircraft Media <sign-in@your-domain.com>", on a domain verified in Resend).
 * Not set up: in local development the email is printed to the server log instead; in production it fails.
 */
export function mailReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.RESEND_API_KEY && !!env.EMAIL_FROM;
}

export interface MailAttachment { filename: string; content: Uint8Array }

export interface Mail {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  /** Instead of EMAIL_FROM (an address on the same verified domain). */
  from?: string;
  replyTo?: string;
  bcc?: string[];
  attachments?: MailAttachment[];
}

export async function sendMail(msg: Mail): Promise<void> {
  const to = Array.isArray(msg.to) ? msg.to : [msg.to];
  if (!mailReady()) {
    if (process.env.NODE_ENV !== "production") {
      const extra = [msg.replyTo && `reply-to ${msg.replyTo}`, msg.bcc?.length && `bcc ${msg.bcc.join(", ")}`, msg.attachments?.length && `${msg.attachments.length} attachment(s): ${msg.attachments.map((a) => a.filename).join(", ")}`].filter(Boolean).join("; ");
      console.log(`[mail not set up: would send to ${to.join(", ")}${extra ? ` (${extra})` : ""}] ${msg.subject}\n${msg.text}`);
      return;
    }
    throw new Error("Email is not set up (RESEND_API_KEY and EMAIL_FROM).");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: msg.from ?? process.env.EMAIL_FROM,
      to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      ...(msg.bcc?.length ? { bcc: msg.bcc } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) } : {}),
    }),
  });
  if (!res.ok) {
    const why = await res.text().catch(() => "");
    console.error("Resend refused the email", res.status, why.slice(0, 300));
    throw new Error(`Email not sent (${res.status}).`);
  }
}
