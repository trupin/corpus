// The chokidar watcher (SPEC.md §2.2 rule 1, §9.1).
//
// Since the server is the sole writer, the watcher is **not** a write channel:
// its whole job is catching what happened *outside* Corpus — an editor saving a
// document, another process dropping an `evt_*.json`, a hook appending to a job
// log — reconciling anchors against the last committed version (§6), re-
// projecting the affected files, and announcing the query keys that went stale.
//
// Two orderings are load-bearing:
//
// - **Project first, broadcast second.** A frame that arrived before the rows
//   were updated would make the UI refetch the state it already had.
// - **Unlinks before adds, within a batch.** A directory rename arrives as
//   unlink(old) + add(new); projecting the new path while the old row still
//   holds the id would be refused as a duplicate, and the document would vanish.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { QUEUE_EVENT_STATUSES, type QueryKey } from "@corpus/contract";
import chokidar, { type FSWatcher } from "chokidar";
import {
  DOCS_KEY,
  JOBS_KEY,
  LOCKS_KEY,
  QUEUE_KEY,
  TREE_KEY,
  docKey,
  jobKey,
  lockKey,
  threadKey,
  type InvalidationBus,
} from "../events/index.js";
import { silentLogger, type Logger } from "../logger.js";
import {
  QUEUE_DIR,
  projectDocument,
  projectEventFile,
  projectJob,
  projectLock,
  projectSeen,
  readDocumentIdentity,
  removeDocument,
  removeEvent,
  removeJob,
  removeLock,
  workspaceRelativePath,
  type DocumentRoot,
  type ProjectionDb,
} from "../projection/index.js";
import type { ReadHeadVersion } from "./git-head.js";
import { WATCH_FILES, WATCH_ROOTS, classifyWatchPath, isIgnoredEntry } from "./paths.js";
import { reconcileOutOfBandEdit } from "./reconcile-out-of-band.js";
import type { SelfWriteRegistry } from "./self-writes.js";

/** Trailing debounce: how long after the last event a batch is flushed. */
export const WATCH_DEBOUNCE_MS = 50;

/**
 * Ceiling on how long a batch may keep growing. A stream of writes (an agent
 * rewriting a folder, a `git checkout`) would otherwise never reach the trailing
 * timer, and §2.2's ~250 ms budget would be missed by a batch that is technically
 * still coalescing.
 */
export const WATCH_MAX_BATCH_MS = 250;

/**
 * Editors write in bursts and rename over their target; chokidar holds an event
 * until the file's size has been stable for this long, which turns one save into
 * one event instead of three.
 */
export const AWAIT_WRITE_FINISH = { stabilityThreshold: 40, pollInterval: 10 } as const;

export type WatchEventKind = "add" | "change" | "unlink";

export interface WatcherHandle {
  /** Resolves once the initial scan is done and events are live. */
  readonly ready: Promise<void>;
  /** Paths whose events have not been processed yet. */
  readonly pending: number;
  /** Processes the pending batch immediately instead of waiting for the timer. */
  flush(): void;
  close(): Promise<void>;
}

export interface StartWatcherOptions {
  readonly db: ProjectionDb;
  readonly bus: InvalidationBus;
  readonly selfWrites: SelfWriteRegistry;
  readonly logger?: Logger | undefined;
  readonly debounceMs?: number | undefined;
  readonly maxBatchMs?: number | undefined;
  readonly readHead?: ReadHeadVersion | undefined;
}

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

export function startWatcher(options: StartWatcherOptions): WatcherHandle {
  const { db, bus, selfWrites } = options;
  const logger = options.logger ?? silentLogger;
  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  const maxBatchMs = options.maxBatchMs ?? WATCH_MAX_BATCH_MS;
  const workspaceRoot = db.config.workspaceRoot;
  const corpusDir = db.config.corpusDir;

  const roots = WATCH_ROOTS.map((root) => join(workspaceRoot, ...root.split("/")));
  for (const root of roots) {
    // A root that does not exist yet is a root chokidar would silently not
    // watch — and `.claude/skills-archived/` legitimately appears only when the
    // first skill is archived.
    mkdirSync(root, { recursive: true });
  }
  // Watched files are *not* created: `mkdirSync` on `.corpus/seen.json` would
  // put a directory where the projector expects a JSON file. chokidar follows a
  // path that does not exist yet and fires `add` when it appears, which is
  // exactly what the first mark-seen produces.
  const files = WATCH_FILES.map((file) => join(workspaceRoot, ...file.split("/")));
  // Exempt from {@link isIgnoredEntry}: the watched roots, the watched files,
  // **and each watched file's directory**.
  //
  // The last one is not decoration. To notice a file that does not exist yet,
  // chokidar has to watch its parent — and `.corpus` is dot-prefixed, so the
  // ignore predicate below rejects it and the watch is never established. The
  // symptom is precisely the sprint-004 gap this issue exists to close, and it
  // hides from any test that seeds the file first: a workspace whose
  // `.corpus/seen.json` already exists watches it correctly, and a fresh one
  // never sees its first mark-seen at all. Directory roots do not need this —
  // chokidar watches them directly, not through their parents.
  const rootSet = new Set([...roots, ...files, ...files.map((file) => dirname(file))]);

  const pending = new Map<string, WatchEventKind>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let batchDeadline = 0;
  let closed = false;

  /** Rows for the document currently projected at `relativePath`, before it is removed. */
  const documentAt = (relativePath: string): { id: string; type: string } | undefined =>
    db.prepare("SELECT id, type FROM documents WHERE path = ?").get(relativePath) as
      { id: string; type: string } | undefined;

  const documentKeys = (id: string, type: string, structural: boolean): QueryKey[] => [
    DOCS_KEY,
    docKey(id),
    ...(type === "thread" ? [threadKey(id)] : []),
    // The folder tree lists names and counts: a body edit cannot change it, a
    // file appearing or disappearing can.
    ...(structural ? [TREE_KEY] : []),
  ];

  /**
   * A duplicate-id refusal whose current holder no longer exists on disk is a
   * rename whose halves reached us out of order (a split batch, or a move the
   * server was down for). Retiring the dead row and retrying converges; leaving
   * it would drop the document from the projection until the next restart.
   */
  const retireStaleHolder = (root: DocumentRoot, relativePath: string, text: string): boolean => {
    const identity = readDocumentIdentity(root, relativePath, text);
    if (identity.kind !== "id") return false;
    const holder = db.prepare("SELECT path FROM documents WHERE id = ?").get(identity.id) as
      { path: string } | undefined;
    if (holder === undefined || holder.path === relativePath) return false;
    const holderAbs = join(workspaceRoot, ...holder.path.split("/"));
    if (existsSync(holderAbs)) return false;
    removeDocument(db, holderAbs);
    return true;
  };

  const collectDocument = (
    keys: QueryKey[],
    root: DocumentRoot,
    absPath: string,
    relativePath: string,
    kind: WatchEventKind,
    content: Buffer | null,
  ): void => {
    if (kind === "unlink" || content === null) {
      const row = documentAt(relativePath);
      removeDocument(db, absPath);
      // No row means nothing was projected from that path — an unparseable file,
      // or one deleted before it was ever indexed.
      if (row !== undefined) keys.push(...documentKeys(row.id, row.type, true));
      return;
    }

    // §6 catch-all, before projecting: the anchors on disk still describe the
    // committed body, so remap them first and let the projection index the
    // reconciled file.
    try {
      reconcileOutOfBandEdit({
        workspaceRoot,
        absPath,
        relativePath,
        content: content.toString("utf8"),
        selfWrites,
        logger,
        ...(options.readHead === undefined ? {} : { readHead: options.readHead }),
      });
    } catch (error) {
      // Reconciliation is a repair, not a precondition: an unwritable file or a
      // git that will not answer must not also cost the document its rows. The
      // anchors stay as the editor left them and the next edit tries again.
      logger.error("anchor reconciliation failed; projecting the file as written", {
        path: relativePath,
        error: String(error),
      });
    }

    const existing = documentAt(relativePath);
    let outcome = projectDocument(db, absPath);
    if (
      outcome.kind === "skipped" &&
      retireStaleHolder(root, relativePath, content.toString("utf8"))
    ) {
      outcome = projectDocument(db, absPath);
    }
    if (outcome.kind === "projected") {
      const type = db.prepare("SELECT type FROM documents WHERE id = ?").get(outcome.id) as
        { type: string } | undefined;
      keys.push(...documentKeys(outcome.id, type?.type ?? "note", existing === undefined));
      return;
    }
    if (outcome.kind === "removed" && existing !== undefined) {
      keys.push(...documentKeys(existing.id, existing.type, true));
      return;
    }
    if (outcome.kind === "skipped") {
      logger.info("watcher skipped a document", { path: relativePath, reason: outcome.reason });
    }
  };

  /** The status directory currently holding an event file, if any. */
  const locateEvent = (id: string): (typeof QUEUE_EVENT_STATUSES)[number] | undefined =>
    QUEUE_EVENT_STATUSES.find((status) =>
      existsSync(join(corpusDir, QUEUE_DIR, status, `${id}.json`)),
    );

  const collect = (keys: QueryKey[], absPath: string, kind: WatchEventKind): void => {
    const relativePath = workspaceRelativePath(workspaceRoot, absPath);
    if (relativePath === null) return;
    const target = classifyWatchPath(relativePath);
    if (target === null) return;

    let content: Buffer | null = null;
    let effective = kind;
    if (kind !== "unlink") {
      try {
        content = readFileSync(absPath);
      } catch (error) {
        // Vanished between the event and the read: a removal, not a failure.
        if (!isEnoent(error)) throw error;
        effective = "unlink";
      }
    }
    // Content-matched, so an external write landing inside the suppression
    // window is still processed — only the server's own bytes are dropped.
    if (selfWrites.claim(absPath, content)) return;

    switch (target.kind) {
      case "document":
        collectDocument(keys, target.root, absPath, relativePath, effective, content);
        return;
      case "queue-event": {
        // A transition is a rename: the unlink half must not delete a row the
        // file's new home still owns.
        const status = effective === "unlink" ? locateEvent(target.id) : target.status;
        if (status === undefined) removeEvent(db, target.id);
        else projectEventFile(db, join(corpusDir, QUEUE_DIR, status, `${target.id}.json`), status);
        // `jobs.status` is joined from `events`, so a transition ages the console
        // row too — but only when one exists; a job row without a log file would
        // be invented state.
        const job = db.prepare("SELECT 1 AS present FROM jobs WHERE event_id = ?").get(target.id);
        if (job !== undefined) projectJob(db, corpusDir, target.id);
        keys.push(QUEUE_KEY, JOBS_KEY);
        return;
      }
      case "lock":
        if (effective === "unlink") removeLock(db, target.docId);
        else projectLock(db, corpusDir, target.docId);
        keys.push(LOCKS_KEY, lockKey(target.docId));
        return;
      case "job":
        if (effective === "unlink") removeJob(db, target.eventId);
        else projectJob(db, corpusDir, target.eventId);
        keys.push(JOBS_KEY, jobKey(target.eventId));
        return;
      case "seen":
        // A whole-file pass: `seen.json` is a flat map with no per-thread event
        // to key on, and the file is small. `projectSeen` tolerates a missing or
        // malformed file, so an unlink and a half-written save are both handled.
        projectSeen(db, corpusDir);
        // Which threads changed is not knowable without diffing, so the
        // collection key is the honest announcement: it is what every unread
        // badge and the Attention view read (`query-keys.ts` names mark-seen).
        keys.push(DOCS_KEY);
        return;
    }
  };

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    batchDeadline = 0;
    if (pending.size === 0) return;
    const batch = [...pending.entries()];
    pending.clear();

    const keys: QueryKey[] = [];
    const ordered = [
      ...batch.filter(([, kind]) => kind === "unlink"),
      ...batch.filter(([, kind]) => kind !== "unlink"),
    ];
    for (const [absPath, kind] of ordered) {
      try {
        collect(keys, absPath, kind);
      } catch (error) {
        // One unreadable file must not cost the rest of the batch its
        // invalidation, nor take the process down.
        logger.error("watcher failed to process a change", {
          path: absPath,
          error: String(error),
        });
      }
    }
    if (keys.length > 0) bus.invalidate(keys);
  };

  const schedule = (): void => {
    const at = Date.now();
    if (batchDeadline === 0) batchDeadline = at + maxBatchMs;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, Math.max(0, Math.min(debounceMs, batchDeadline - at)));
    timer.unref?.();
  };

  const record = (kind: WatchEventKind, absPath: string): void => {
    if (closed) return;
    pending.set(absPath, kind);
    schedule();
  };

  const watcher: FSWatcher = chokidar.watch([...roots, ...files], {
    ignoreInitial: true,
    awaitWriteFinish: { ...AWAIT_WRITE_FINISH },
    // The roots themselves carry dot-prefixed segments (`.corpus`, `.claude`);
    // only what lives *inside* them is filtered.
    ignored: (path) => !rootSet.has(path) && isIgnoredEntry(basename(path)),
  });

  watcher.on("add", (path) => {
    record("add", path);
  });
  watcher.on("change", (path) => {
    record("change", path);
  });
  watcher.on("unlink", (path) => {
    record("unlink", path);
  });
  watcher.on("error", (error) => {
    logger.error("watcher error", { error: String(error) });
  });

  const ready = new Promise<void>((resolve) => {
    watcher.on("ready", () => {
      logger.debug("watcher ready", { roots: roots.length });
      resolve();
    });
  });

  return {
    ready,
    get pending() {
      return pending.size;
    },
    flush,
    async close() {
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending.clear();
      await watcher.close();
    },
  };
}
