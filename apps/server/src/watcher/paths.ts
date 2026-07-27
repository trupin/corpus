// What the watcher watches, and what a path under those roots means (SPEC.md
// §9.1).
//
// Classification is **pure string arithmetic**: no filesystem access, so a
// deletion — whose file is already gone by the time the event arrives — is
// classified exactly like a creation.

import { QUEUE_EVENT_STATUSES, type QueueEventStatus } from "@corpus/contract";
import { classifyPath, type DocumentRoot } from "../projection/index.js";

/**
 * The roots chokidar watches, workspace-relative. `data/` covers both document
 * roots under it; the three runtime roots under `.corpus/` are watched because
 * an `evt_*.json`, a lock or a job log dropped by another process is state the
 * projection has to learn about without a restart (the mirror-wiring handoff).
 *
 * `.corpus/attachments/` is deliberately absent: its bytes are served, never
 * projected. So is `.corpus/cache.db`, which *is* the projection.
 */
export const WATCH_ROOTS = [
  "data",
  ".claude/skills",
  ".claude/skills-archived",
  ".claude/agents",
  ".corpus/queue",
  ".corpus/locks",
  ".corpus/jobs",
] as const;

/**
 * Individual **files** the watcher follows, as opposed to the directory roots
 * above. `.corpus/seen.json` is a bare file directly under `.corpus/`, so no
 * root covers it and its own directory holds `cache.db` and the config — things
 * that must not be watched. Watching the single file closes the sprint-004
 * evaluator's gap: an out-of-band edit to read state now re-projects like every
 * other root instead of needing a restart (SERVER-006 AC, TEST-52).
 *
 * These are never `mkdir`ed — a missing file is a file chokidar picks up when it
 * appears, and creating a *directory* by that name would break the projector.
 */
export const WATCH_FILES = [".corpus/seen.json"] as const;

/** `.corpus/` subdirectory names, mirroring `projection/project-runtime.ts`. */
const QUEUE_SEGMENT = ".corpus/queue";
const LOCKS_SEGMENT = ".corpus/locks";
const JOBS_SEGMENT = ".corpus/jobs";
const SEEN_PATH = ".corpus/seen.json";

const EVENT_FILE = /^(evt_[A-Za-z0-9]+)\.json$/;
const JOB_FILE = /^(evt_[A-Za-z0-9]+)\.jsonl$/;
const LOCK_FILE = /^((?:doc|th)_[A-Za-z0-9]+)\.json$/;

const EVENT_STATUSES: readonly string[] = QUEUE_EVENT_STATUSES;

export type WatchTarget =
  | { readonly kind: "document"; readonly root: DocumentRoot }
  | { readonly kind: "queue-event"; readonly status: QueueEventStatus; readonly id: string }
  | { readonly kind: "lock"; readonly docId: string }
  | { readonly kind: "job"; readonly eventId: string }
  /** `.corpus/seen.json` — read state, projected as one whole-file pass (§7). */
  | { readonly kind: "seen" };

/**
 * Editor debris and files that are not corpus state. Everything dot-prefixed is
 * covered in one rule — `.gitkeep`, `.DS_Store`, vim's `.file.swp`, emacs's
 * `.#file`, and the `.tmp-*` files every atomic write in this codebase leaves
 * next to its target — which is also exactly what the projection's own walk
 * skips, so the watcher and a rebuild can never disagree about what exists.
 */
export function isIgnoredEntry(basename: string): boolean {
  if (basename === "") return false;
  if (basename.startsWith(".")) return true;
  if (basename === "node_modules") return true;
  if (basename.endsWith("~")) return true;
  if (basename.startsWith("#") && basename.endsWith("#")) return true;
  return /\.sw[a-z]$/i.test(basename);
}

/** The meaning of a workspace-relative path, or `null` when it is not corpus state. */
export function classifyWatchPath(relativePath: string): WatchTarget | null {
  const documentRoot = classifyPath(relativePath);
  if (documentRoot !== null) return { kind: "document", root: documentRoot };

  if (relativePath === SEEN_PATH) return { kind: "seen" };

  const segments = relativePath.split("/");
  const filename = segments.at(-1);
  if (filename === undefined) return null;

  if (relativePath.startsWith(`${QUEUE_SEGMENT}/`) && segments.length === 4) {
    const status = segments[2];
    const id = EVENT_FILE.exec(filename)?.[1];
    if (id === undefined || status === undefined || !EVENT_STATUSES.includes(status)) return null;
    return { kind: "queue-event", status: status as QueueEventStatus, id };
  }

  if (relativePath.startsWith(`${LOCKS_SEGMENT}/`) && segments.length === 3) {
    const docId = LOCK_FILE.exec(filename)?.[1];
    return docId === undefined ? null : { kind: "lock", docId };
  }

  if (relativePath.startsWith(`${JOBS_SEGMENT}/`) && segments.length === 3) {
    const eventId = JOB_FILE.exec(filename)?.[1];
    return eventId === undefined ? null : { kind: "job", eventId };
  }

  return null;
}
