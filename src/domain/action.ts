import { and, eq } from "drizzle-orm";
import { actionExecutions } from "../db/schema";
import type { Db } from "../db/client";
import { fingerprint } from "../lib/hash";
import type { ActionStatus } from "./constants";
import { DomainError } from "./errors";

export type Actor = { id: string; tenantId: string };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface RunOptions<I, R> {
  db: Db;
  actor: Actor;
  name: string;
  /** Client-supplied (or content-derived) key. Same key + same input => original recorded result. */
  idempotencyKey: string;
  input: I;
  /** Override what is fingerprinted (e.g. upload: hash only, so the same bytes under another filename is a retry). */
  fingerprintOf?: unknown;
  /** Batch actions report per-item outcomes: return "partially_succeeded" when some items failed. */
  statusOf?: (result: R) => ActionStatus;
  handler: (tx: Tx) => Promise<R>;
}

export interface ActionOutcome<R> {
  result: R;
  /** true when this call returned a previously recorded result without executing again */
  replayed: boolean;
  executionId: string;
}

/**
 * Deterministic action runner:
 *  - unique (tenant, action, key); a reused key with a different input fingerprint is an error and nothing executes
 *  - a succeeded key returns the original recorded result
 *  - a failed key may be retried (the handler runs inside one transaction, so failures leave no partial writes)
 *  - an in-flight (pending) key is refused rather than executed twice
 */
export async function runAction<I, R>(opts: RunOptions<I, R>): Promise<ActionOutcome<R>> {
  const { db, actor, name, idempotencyKey } = opts;
  const fp = fingerprint(opts.fingerprintOf ?? opts.input);

  const claimed = await db
    .insert(actionExecutions)
    .values({
      tenantId: actor.tenantId,
      userId: actor.id,
      actionName: name,
      idempotencyKey,
      inputFingerprint: fp,
      status: "pending",
    })
    .onConflictDoNothing()
    .returning({ id: actionExecutions.id });

  let executionId: string;

  if (claimed.length === 1) {
    executionId = claimed[0].id;
  } else {
    const [existing] = await db
      .select()
      .from(actionExecutions)
      .where(
        and(
          eq(actionExecutions.tenantId, actor.tenantId),
          eq(actionExecutions.actionName, name),
          eq(actionExecutions.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing.inputFingerprint !== fp) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used with different input. Nothing was executed.",
      );
    }
    if (existing.status === "succeeded" || existing.status === "partially_succeeded") {
      return { result: existing.result as R, replayed: true, executionId: existing.id };
    }
    if (existing.status === "pending" || existing.status === "outcome_uncertain") {
      throw new DomainError("IN_PROGRESS", "This request is already being processed.");
    }
    // failed -> allow a retry of the same request
    await db
      .update(actionExecutions)
      .set({ status: "pending", safeError: null, updatedAt: new Date() })
      .where(eq(actionExecutions.id, existing.id));
    executionId = existing.id;
  }

  try {
    const result = await db.transaction((tx) => opts.handler(tx));
    await db
      .update(actionExecutions)
      .set({
        status: opts.statusOf?.(result) ?? "succeeded",
        result: result as unknown,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(actionExecutions.id, executionId));
    return { result, replayed: false, executionId };
  } catch (e) {
    const safe = e instanceof DomainError ? e.message : "Unexpected error; the request was not applied.";
    await db
      .update(actionExecutions)
      .set({ status: "failed", safeError: safe, updatedAt: new Date() })
      .where(eq(actionExecutions.id, executionId));
    throw e;
  }
}
