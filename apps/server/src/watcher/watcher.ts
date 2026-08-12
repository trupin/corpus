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
//
// And one measurement is load-bearing: `["tree"]` is decided by comparing
// {@link folderTreeSignature} across the batch, never by the *shape* of the
// events in it (SERVER-020). See {@link FlushContext}.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { QUEUE_EVENT_STATUSES, type QueryKey } from "@corpus/contract";
import chokidar, { type FSWatcher } from "chokidar";
import { folderTreeSignature } from "../docs/tree.js";
import {
  DOCS_KEY,
  JOBS_KEY,
  QUEUE_KEY,
  TREE_KEY,
  docKey,
  jobKey,
  threadKey,
  type InvalidationBus,
} from "../events/index.js";
import type { AnchorChange } from "../git/index.js";
import { silentLogger, type Logger } from "../logger.js";
import {
  QUEUE_DIR,
  projectDocument,
  projectEventFile,
  projectJob,
  projectSeen,
  readDocumentIdentity,
  removeDocument,
  removeEvent,
  removeJob,
  workspaceRelativePath,
  type DocumentRoot,
  type ProjectionDb,
} from "../projection/index.js";
import type { CommitOutOfBandChanges, OutOfBandChange } from "./commit-out-of-band.js";
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

/**
 * How long one `flush()` may hold the event loop before the rest of its batch is
 * deferred to a later turn.
 *
 * `flush()` is synchronous by necessity — projecting rows and reconciling
 * anchors are both synchronous, and interleaving a second flush with the first
 * would break the unlink-before-add ordering above. Synchronous *and unbounded*
 * is the problem: reconciling one anchored document runs `git show` through
 * `execFileSync` (`git-head.ts`), so a batch of N anchored files is N sequential
 * subprocess calls with nothing else served in between. Measured on a real
 * server before this bound existed, a single out-of-band edit to 100 anchored
 * documents held `GET /api/health` for 575 ms; 25 documents held it for 179 ms.
 * The cost was linear in N, which is another way of saying there was no bound at
 * all — a `git checkout` across a large corpus, or one wedged `git` sitting at
 * its 5 s timeout, could stall every request in the process.
 *
 * So a batch that outruns this budget stops and hands its remainder back to
 * `pending`, which is re-scheduled for the next turn of the loop. Nothing is
 * dropped: every deferred path is collected — reconciled, projected, announced —
 * by a later flush, and each flush emits its own correct frame. What changes is
 * only *when*, which bounds the worst-case blocking at this budget plus the cost
 * of the one entry that was already in flight when it expired (`GIT_TIMEOUT_MS`
 * in the wedged-git case), independently of how large the batch is.
 *
 * The value leaves the loop free for the majority of any batch window: SPEC.md
 * §2.2 budgets ~250 ms for a change to reach the UI, and a watcher that owned
 * the process for longer than that would be missing the budget it exists to
 * meet.
 */
export const WATCH_FLUSH_BUDGET_MS = 100;

export type WatchEventKind = "add" | "change" | "unlink";

export interface WatcherHandle {
  /** Resolves once the initial scan is done and events are live. */
  readonly ready: Promise<void>;
  /** Paths whose events have not been processed yet. */
  readonly pending: number;
  /**
   * Processes the pending batch immediately instead of waiting for the timer.
   *
   * Subject to {@link WATCH_FLUSH_BUDGET_MS} like any other flush, so a batch
   * big enough to outrun the budget leaves a remainder in {@link pending} and
   * schedules itself to finish; this returns when the *budget* is spent, not
   * necessarily when the batch is drained.
   */
  flush(): void;
  /**
   * Resolves once every commit the flushes so far handed to the committer has
   * landed (SPEC.md §4, SERVER-090).
   *
   * A flush is synchronous — projecting rows and reconciling anchors both are —
   * and committing is not, so the commit for a batch is chained *after* the
   * flush that found it rather than inside it. This is how a caller waits for
   * that chain: `close()` awaits it, and a test that asserts on `git log` has to.
   */
  settled(): Promise<void>;
  close(): Promise<void>;
}

export interface StartWatcherOptions {
  readonly db: ProjectionDb;
  readonly bus: InvalidationBus;
  readonly selfWrites: SelfWriteRegistry;
  readonly logger?: Logger | undefined;
  readonly debounceMs?: number | undefined;
  readonly maxBatchMs?: number | undefined;
  /** Defaults to {@link WATCH_FLUSH_BUDGET_MS}. */
  readonly flushBudgetMs?: number | undefined;
  readonly readHead?: ReadHeadVersion | undefined;
  /**
   * Commits what an outside editor changed, authored `user` (SPEC.md §4,
   * SERVER-090). Omitted on a server built without a git writer, which is the
   * same condition every other filesystem-backed subsystem is built under; the
   * watcher then projects and announces exactly as it always did.
   */
  readonly commitOutOfBand?: CommitOutOfBandChanges | undefined;
}

/**
 * Everything one `flush()` accumulates, threaded through `collect` so no state
 * survives between batches.
 *
 * `captureTree` is the whole of SERVER-020. `["tree"]` used to be decided by a
 * `structural` boolean — true for add/unlink, false for change — and that
 * heuristic was wrong in both directions, because `GET /api/tree` counts
 * something narrower than "a document file changed": it lists only
 * `data/docs/**`, excludes archived documents, and counts a thread under its
 * *parent's* folder. So an on-disk edit setting `status: archived` emptied a
 * folder while announcing nothing, and a skill file appearing under
 * `.claude/skills/` announced `["tree"]` though skills are counted nowhere.
 *
 * The fix is the one `runMutation` already uses (SERVER-018): snapshot the
 * signature of the tree the route itself would return, re-project, compare. It
 * is a measurement rather than a prediction, so it cannot disagree with
 * `docs/tree.ts` about what moves a folder badge — and it is taken lazily,
 * because a batch of queue events or job logs can never move one.
 */
interface FlushContext {
  /** Keys the batch has accumulated, deduped by the bus on the way out. */
  readonly keys: QueryKey[];
  /** Snapshots the tree, once per batch, before its first row is touched. */
  captureTree(): void;
  /**
   * Documents this batch saw change on disk without the server having written
   * them — committed after the flush, authored `user` (SERVER-090). Order is the
   * order they were processed, which puts removals first (see `flush`), so a
   * rename's two halves reach git in the order that makes it a rename.
   */
  readonly commits: OutOfBandChange[];
}

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

/** What the projection knows about the document at a path — the trailer's `docId`, and the subject's words. */
interface DocumentIdentity {
  readonly id: string;
  readonly type: string;
  readonly title: string;
}

export function startWatcher(options: StartWatcherOptions): WatcherHandle {
  const { db, bus, selfWrites, commitOutOfBand } = options;
  const logger = options.logger ?? silentLogger;
  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  const maxBatchMs = options.maxBatchMs ?? WATCH_MAX_BATCH_MS;
  const flushBudgetMs = options.flushBudgetMs ?? WATCH_FLUSH_BUDGET_MS;
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
  /**
   * The tail of the out-of-band commit chain (SERVER-090). Always settled, never
   * rejected: `handleCommitFailure` swallows, because §14 already rules that a
   * change stands on disk when its commit does not, and an unhandled rejection
   * here would take the process down over a workspace hook.
   */
  let settling: Promise<void> = Promise.resolve();
  const handleCommitFailure = (error: unknown): void => {
    logger.error("committing an out-of-band edit failed; the change stands on disk", {
      error: String(error),
    });
  };

  /** Rows for the document currently projected at `relativePath`, before it is removed. */
  const documentAt = (relativePath: string): DocumentIdentity | undefined =>
    db.prepare("SELECT id, type, title FROM documents WHERE path = ?").get(relativePath) as
      DocumentIdentity | undefined;

  /**
   * Records the batch's out-of-band change to one document (SERVER-090).
   *
   * `identity` is the projection's answer for that path — after the row is
   * rebuilt for a write, from before it is dropped for a removal. A path the
   * projection names no document for records nothing: `Corpus-Doc` has no id to
   * carry and the window has no document to hold, and naming a guess would be
   * worse than the boot recovery that covers the case (`git/recovery.ts`). What
   * lands there is exactly the file that has never been a document of this
   * workspace — unparseable frontmatter, or a hand-dropped file with no id.
   */
  const recordOutOfBand = (
    context: FlushContext,
    paths: readonly string[],
    identity: DocumentIdentity | undefined,
    removed: boolean,
    anchors: AnchorChange | undefined,
  ): void => {
    if (commitOutOfBand === undefined) return;
    if (identity === undefined) {
      logger.debug("an out-of-band change to a path the projection names no document for", {
        paths: [...paths],
      });
      return;
    }
    context.commits.push({
      docId: identity.id,
      paths: [...paths],
      title: identity.title,
      type: identity.type,
      removed,
      ...(anchors === undefined ? {} : { anchors }),
    });
  };

  // No `["tree"]` here, deliberately: whether the folder tree moved is measured
  // once per batch in `flush()`, not guessed per event. See {@link FlushContext}.
  const documentKeys = (id: string, type: string): QueryKey[] => [
    DOCS_KEY,
    docKey(id),
    ...(type === "thread" ? [threadKey(id)] : []),
  ];

  /**
   * A duplicate-id refusal whose current holder no longer exists on disk is a
   * rename whose halves reached us out of order (a split batch, or a move the
   * server was down for). Retiring the dead row and retrying converges; leaving
   * it would drop the document from the projection until the next restart.
   *
   * Returns the path it retired, because that path is also **the other half of
   * the commit** (SERVER-090): the old name's removal has to be staged with the
   * new name's arrival or git records a creation and leaves a deletion behind.
   * The unlink half cannot record it once this has run — the row it would have
   * read is the row this just retired — so it is recorded here.
   */
  const retireStaleHolder = (
    root: DocumentRoot,
    relativePath: string,
    text: string,
  ): string | null => {
    const identity = readDocumentIdentity(root, relativePath, text);
    if (identity.kind !== "id") return null;
    const holder = db.prepare("SELECT path FROM documents WHERE id = ?").get(identity.id) as
      { path: string } | undefined;
    if (holder === undefined || holder.path === relativePath) return null;
    const holderAbs = join(workspaceRoot, ...holder.path.split("/"));
    if (existsSync(holderAbs)) return null;
    removeDocument(db, holderAbs);
    return holder.path;
  };

  const collectDocument = (
    context: FlushContext,
    root: DocumentRoot,
    absPath: string,
    relativePath: string,
    kind: WatchEventKind,
    content: Buffer | null,
  ): void => {
    // Before the first row of the batch moves — the tree is derived from rows,
    // so this is the last moment it still answers what a client already has.
    context.captureTree();
    const keys = context.keys;

    if (kind === "unlink" || content === null) {
      const row = documentAt(relativePath);
      removeDocument(db, absPath);
      // No row means nothing was projected from that path — an unparseable file,
      // or one deleted before it was ever indexed.
      if (row !== undefined) keys.push(...documentKeys(row.id, row.type));
      recordOutOfBand(context, [relativePath], row, true, undefined);
      return;
    }

    // §6 catch-all, before projecting: the anchors on disk still describe the
    // committed body, so remap them first and let the projection index the
    // reconciled file.
    //
    // It runs before the commit as well as before the projection, and that is
    // load-bearing rather than incidental: the commit takes the working tree as
    // it stands, so the remapped `anchors` block and the person's own edit land
    // in one commit as the single change to the file they are (SERVER-090).
    let anchors: AnchorChange | undefined;
    try {
      const reconciled = reconcileOutOfBandEdit({
        workspaceRoot,
        absPath,
        relativePath,
        content: content.toString("utf8"),
        selfWrites,
        logger,
        ...(options.readHead === undefined ? {} : { readHead: options.readHead }),
      });
      if (reconciled.kind === "reconciled") {
        anchors = { remapped: reconciled.report.remapped, orphaned: reconciled.report.orphaned };
      }
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
    let retired: string | null = null;
    if (outcome.kind === "skipped") {
      retired = retireStaleHolder(root, relativePath, content.toString("utf8"));
      if (retired !== null) outcome = projectDocument(db, absPath);
    }
    // The old name goes into the same commit as the new one when a rename's
    // halves reached us in the order that hides the removal (SERVER-090).
    const paths = retired === null ? [relativePath] : [relativePath, retired];
    if (outcome.kind === "projected") {
      const projected = documentAt(relativePath);
      keys.push(...documentKeys(outcome.id, projected?.type ?? "note"));
      recordOutOfBand(context, paths, projected, false, anchors);
      return;
    }
    // The file is still on disk in both branches below — the projection declined
    // it, which is a statement about the rows and not about the workspace (§5:
    // the file is the truth). So it is still a change someone made out of band,
    // and it is still committed, under whatever document that path last was.
    if (outcome.kind === "removed" && existing !== undefined) {
      keys.push(...documentKeys(existing.id, existing.type));
      recordOutOfBand(context, paths, existing, false, anchors);
      return;
    }
    if (outcome.kind === "skipped") {
      logger.info("watcher skipped a document", { path: relativePath, reason: outcome.reason });
      recordOutOfBand(context, paths, existing, false, anchors);
    }
  };

  /** The status directory currently holding an event file, if any. */
  const locateEvent = (id: string): (typeof QUEUE_EVENT_STATUSES)[number] | undefined =>
    QUEUE_EVENT_STATUSES.find((status) =>
      existsSync(join(corpusDir, QUEUE_DIR, status, `${id}.json`)),
    );

  const collect = (context: FlushContext, absPath: string, kind: WatchEventKind): void => {
    const keys = context.keys;
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
        collectDocument(context, target.root, absPath, relativePath, effective, content);
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
        // `DOCS_KEY` for the same reason `QUEUE_QUERY_KEYS` carries it: the
        // `failed-job` needs reason reads `events.status`, so an out-of-band
        // transition changes what `GET /api/docs?needs=me` answers (SERVER-028).
        keys.push(QUEUE_KEY, JOBS_KEY, DOCS_KEY);
        return;
      }
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
    const commits: OutOfBandChange[] = [];
    let treeBefore: string | null = null;
    const context: FlushContext = {
      keys,
      commits,
      captureTree() {
        treeBefore ??= folderTreeSignature(db);
      },
    };

    const ordered = [
      ...batch.filter(([, kind]) => kind === "unlink"),
      ...batch.filter(([, kind]) => kind !== "unlink"),
    ];
    const budgetEnd = Date.now() + flushBudgetMs;
    let deferred = 0;
    for (const [index, entry] of ordered.entries()) {
      const [absPath, kind] = entry;
      // Deferral is a *suffix* of the batch, never a hole in it: once one entry
      // is put back, every entry after it goes with it, so unlink-before-add
      // survives the split (unlinks are the head of `ordered`, and the next
      // flush re-sorts what it gets). The first entry always runs — a bound
      // that can decline to make progress is a livelock, not a bound.
      if (deferred > 0 || (index > 0 && Date.now() >= budgetEnd)) {
        deferred += 1;
        // A newer event for the same path, recorded while this batch ran, is
        // the truer one; putting the old kind back must not overwrite it.
        if (!pending.has(absPath)) pending.set(absPath, kind);
        continue;
      }
      try {
        collect(context, absPath, kind);
      } catch (error) {
        // One unreadable file must not cost the rest of the batch its
        // invalidation, nor take the process down.
        logger.error("watcher failed to process a change", {
          path: absPath,
          error: String(error),
        });
      }
    }

    // `treeBefore` stays null unless the batch touched a document path, which
    // is the only kind of change that can move a folder badge.
    if (treeBefore !== null && folderTreeSignature(db) !== treeBefore) keys.push(TREE_KEY);
    if (keys.length > 0) bus.invalidate(keys);

    // SPEC.md §4, SERVER-090: an out-of-band edit is committed for itself,
    // authored `user`. Chained rather than awaited — `flush()` is synchronous by
    // necessity (see {@link WATCH_FLUSH_BUDGET_MS}) and a commit is not — and
    // chained rather than fired, because folding into §4's open window depends on
    // each commit seeing what the previous one left. The invalidation goes out
    // first: a client refetches rows, and the rows are already current.
    if (commits.length > 0 && commitOutOfBand !== undefined) {
      const run = commitOutOfBand;
      settling = settling.then(() => run(commits)).catch(handleCommitFailure);
    }

    if (deferred > 0 && !closed) {
      logger.debug("watcher deferred the rest of a batch", {
        processed: ordered.length - deferred,
        deferred,
        budgetMs: flushBudgetMs,
      });
      // Already overdue, so it waits only for the loop to turn — not for
      // another debounce window. Holding the batch deadline at *now* rather
      // than letting `schedule` re-open it is what makes that stick: an event
      // arriving in the meantime calls `schedule()` with the full debounce, and
      // an expired deadline collapses it back to zero.
      batchDeadline = Date.now();
      schedule(0);
    }
  };

  const schedule = (delayMs?: number): void => {
    const at = Date.now();
    if (batchDeadline === 0) batchDeadline = at + maxBatchMs;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, Math.max(0, Math.min(delayMs ?? debounceMs, batchDeadline - at)));
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
    settled: () => settling,
    async close() {
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending.clear();
      // Before chokidar, and therefore before the shutdown's `closeWindow`
      // disposer, which is registered earlier and so runs later: a commit still
      // in flight has to land inside the window it opened, or §4's clean stop
      // would close a window that gains a commit right after.
      await settling;
      await watcher.close();
    },
  };
}
