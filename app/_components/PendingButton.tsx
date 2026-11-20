"use client";

import { useFormStatus } from "react-dom";

/** A submit button that says what is happening while its form is being sent, and cannot be pressed twice. */
export function PendingButton({ children, pending, className }: { children: React.ReactNode; pending: string; className?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={busy} aria-busy={busy}>
      {busy ? pending : children}
    </button>
  );
}
