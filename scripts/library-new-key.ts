/**
 * Makes a new library upload key and saves it in .env.local as LIBRARY_UPLOAD_KEY (replacing an older one).
 *
 *   npm run library:new-key
 *
 * The key is not printed: open .env.local, copy the value after LIBRARY_UPLOAD_KEY=, and put it in Render → Environment
 * under the same name. Never paste it into a chat or commit it.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = ".env.local";
const key = randomBytes(32).toString("base64url");
const text = existsSync(file) ? readFileSync(file, "utf8") : "";
const nl = text.includes("\r\n") ? "\r\n" : "\n";
const line = `LIBRARY_UPLOAD_KEY=${key}`;
const next = /^LIBRARY_UPLOAD_KEY=.*$/m.test(text)
  ? text.replace(/^LIBRARY_UPLOAD_KEY=.*$/m, line)
  : text + (text && !text.endsWith(nl) ? nl : "") + line + nl;
writeFileSync(file, next);
console.log("✓ A new LIBRARY_UPLOAD_KEY is saved in .env.local.");
console.log("  Open .env.local, copy the value after LIBRARY_UPLOAD_KEY=, and add it in Render → aircraft-media → Environment");
console.log("  under the same name. Don't paste it into any chat.");
