// The write-path lock guard (SPEC.md §7): "document write paths refuse edits to
// a document locked by the other party, identifying the holder".
//
// This is the seam SERVER-005's pipeline calls — `assertWritable(docId, actor)`
// on every document write verb (`PUT /api/docs/{id}`, move, archive, unarchive,
// delete), one call site per verb. It is deliberately a *helper* rather than
// only a middleware: the write path already has the validated id and actor in
// hand, and a guard that has to re-parse the request is a guard that can
// disagree with the handler about what is being written.
//
// Two things are deliberately **not** guarded:
//
//   - **Reads.** `GET /api/docs` and `GET /api/docs/{id}` are never blocked. §7
//     scopes locks to editing; a banner tells the reader who is editing, it does
//     not hide the document.
//   - **Thread creation and turns** (SERVER-006). Commenting is not editing:
//     §7's lock is the edit lock, and posting a comment on a document the agent
//     is editing must keep working. The anchor entry that thread creation writes
//     into the parent's frontmatter rides that exemption — it is part of
//     commenting, not an edit of the document's content.

import type { MiddlewareHandler } from "hono";
import { ACTORS, ACTOR_HEADER, DEFAULT_ACTOR, type Actor } from "@corpus/contract";
import { errorResponse, locked, toHttpError } from "../errors.js";
import type { LockService } from "./service.js";

export interface LockGuard {
  /**
   * Throws `423 Locked` — carrying the contract's `LockedError`, whose `lock`
   * names the holder, when it acquired the lease and how long it runs — when the
   * *other* party holds a live lock on the document. The holder's own writes
   * pass: holding the lock is what the lock is for. An expired lease blocks
   * nothing, even before the reaper has unlinked its file.
   */
  assertWritable(docId: string, actor: Actor): Promise<void>;
}

export function createLockGuard(locks: LockService): LockGuard {
  return {
    async assertWritable(docId, actor) {
      const lock = await locks.liveLock(docId);
      if (lock === undefined || lock.holder === actor) return;
      throw locked(
        `${docId} is being edited by ${lock.holder}; the lock was acquired at ${lock.acquired}`,
        lock,
      );
    },
  };
}

/** The acting party a request declares, defaulting the way every mutating route does. */
export function actorFromRequest(header: string | undefined): Actor {
  const candidate = header?.trim().toLowerCase();
  return ACTORS.find((actor) => actor === candidate) ?? DEFAULT_ACTOR;
}

export interface LockGuardMiddlewareOptions {
  /** Path parameter naming the document; `id` on every document route. */
  readonly param?: string;
}

/**
 * The same guard as a middleware, for a write route that would rather mount it
 * than call it. Route-scoped by construction — mounting it on a prefix would
 * block reads, which §7 does not.
 */
export function createLockGuardMiddleware(
  guard: LockGuard,
  options: LockGuardMiddlewareOptions = {},
): MiddlewareHandler {
  const param = options.param ?? "id";
  return async (c, next) => {
    const docId = c.req.param(param);
    // No id in the path means this is not a per-document write; validation will
    // have its own opinion about that, and it is not the guard's to have.
    if (docId === undefined || docId === "") return next();
    try {
      await guard.assertWritable(docId, actorFromRequest(c.req.header(ACTOR_HEADER)));
    } catch (error) {
      return errorResponse(c, toHttpError(error));
    }
    return next();
  };
}
