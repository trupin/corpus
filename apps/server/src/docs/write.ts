// The one document mutation pipeline (Architecture Decision 2 — "the server is
// the sole writer"; SPEC.md §4, §9.1, §14).
//
// Create, edit, move, archive, unarchive and delete each build a
// {@link MutationPlan} and hand it here, so the invariants live in exactly one
// place and cannot drift verb by verb:
//
//   validate → write atomically → auto-commit → re-project synchronously →
//   broadcast invalidation
//
// Ordering is load-bearing, not stylistic:
//
// - **Validation runs before anything touches disk.** A rejected mutation
//   leaves the workspace byte-for-byte as it was — no partial write, no orphan
//   temp file, no commit.
// - **A multi-file plan is all-or-nothing.** Anchored thread creation writes two
//   files; if the second fails, the first is restored before the error
//   propagates, so an anchor entry can never outlive the thread it names (§6).
// - **The commit is allowed to fail.** SPEC.md §14: a workspace hook that
//   rejects the commit does not roll back the file, because the file is the
//   source of truth. The failure surfaces loudly instead.
// - **Projection is synchronous and happens before the response.** That is
//   §9.1's read-your-write guarantee: the `GET` in the very next command
//   already sees the change, with no watcher involvement and no polling.
// - **The invalidation is broadcast last**, after the projection is current, so
//   a client that refetches the instant the frame arrives cannot read stale
//   rows.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import type { Actor, QueryKey, ValidationIssue, Warning, WarningCode } from "@corpus/contract";
import {
  CHECK_CODES,
  PathTraversalError,
  checkCorpus,
  normalizeDocFolder,
  toCheckDocument,
  type CheckCode,
} from "../core/index.js";
import { resolveAnchorExact } from "../anchors/index.js";
import { badRequest } from "../errors.js";
import type { InvalidationBus } from "../events/index.js";
import { dedupeKeys } from "../events/index.js";
import type { AnchorChange, AutoCommitter, CommitOutcome } from "../git/index.js";
import type { Logger } from "../logger.js";
import { classifyPath, projectDocument, removeDocument } from "../projection/index.js";
import type { ProjectionDb } from "../projection/index.js";
import type { SelfWriteRegistry } from "../watcher/index.js";
import { isIdTaken } from "./read.js";

/**
 * The §14 rules a **single** document decides on its own. The rest of the
 * checker's rules — duplicate ids across the corpus, a thread's parent, whether
 * some thread claims each anchor entry — are cross-document, and running them
 * over one file would reject every save of an anchored document because its
 * threads were not in the set. Those belong to `corpus doc check`, which sees
 * the whole workspace; a save validates what a save can actually break.
 */
const LOCAL_CHECK_CODES: ReadonlySet<CheckCode> = new Set([
  CHECK_CODES.frontmatterUnparseable,
  CHECK_CODES.frontmatterInvalid,
  CHECK_CODES.idPrefixMismatch,
  CHECK_CODES.anchorMalformed,
  CHECK_CODES.duplicateAnchorId,
  CHECK_CODES.duplicateTurnTimestamp,
]);

/**
 * Which check findings become §14 response warnings, and under which code.
 *
 * The checker already produces both halves of §14's validation family while
 * validating the bytes about to be written, so the mapping is a rename rather
 * than a second pass: an anchor whose quote no longer resolves is
 * `orphaned_anchor`, a `[[ref]]` naming no document is `unresolved_ref`. Every
 * other finding is either a hard error (which throws) or a cross-document rule
 * a single-file save cannot judge (see {@link LOCAL_CHECK_CODES}).
 */
const WARNING_CODE_BY_CHECK: Partial<Record<CheckCode, WarningCode>> = {
  [CHECK_CODES.anchorUnresolved]: "orphaned_anchor",
  [CHECK_CODES.refUnresolved]: "unresolved_ref",
};

/** How much hook output a warning carries; the full text is always in the log. */
export const WARNING_DETAIL_LINES = 5;
export const WARNING_DETAIL_LENGTH = 600;

export type FileOperation =
  | { readonly kind: "write"; readonly path: string; readonly content: string }
  | { readonly kind: "remove"; readonly path: string }
  | {
      readonly kind: "renameFile";
      readonly from: string;
      readonly to: string;
      readonly content: string;
    }
  /**
   * Whole-directory move — §7's skill archiving, which relocates `SKILL.md`
   * together with every sibling (references, scripts). `documents` names the
   * projectable files inside it, whose old paths must be registered as
   * self-writes before the directory moves out from under the watcher.
   */
  | {
      readonly kind: "renameDir";
      readonly from: string;
      readonly to: string;
      readonly documents: readonly string[];
    };

export type MutationPlan = {
  readonly operations: readonly FileOperation[];
  /** Workspace-relative paths (files or directories) the commit stages. */
  readonly stage: readonly string[];
  /** Document files whose rows must be rebuilt after the write. */
  readonly project: readonly string[];
  /** Document files whose rows must be dropped after the write. */
  readonly unproject: readonly string[];
  readonly commit: { readonly subject: string; readonly anchors?: AnchorChange | undefined } | null;
  readonly keys: readonly QueryKey[];
};

export type MutationResult = {
  /** False for a save that named no change: nothing written, nothing committed, nothing announced. */
  readonly changed: boolean;
  /**
   * SPEC.md §14's warnings, in the order they were noticed: what validation saw
   * in the bytes it let through, then what the auto-commit did or could not do.
   * Never a reason to fail the mutation — every one of them describes a write
   * that already stands on disk.
   */
  readonly warnings: readonly Warning[];
  readonly commit: CommitOutcome | null;
};

/**
 * The lock guard (SPEC.md §7): it throws the `423 LockedError` when the *other*
 * party holds the document's edit lock. Declared as a seam rather than an import
 * of `locks/` so the pipeline stays testable without a lock store, and so there
 * is exactly one call site per write verb — each verb calls it once, before it
 * reads or writes anything. `locks/guard.ts` is the implementation.
 */
export type WriteGuard = (docId: string, actor: Actor) => void | Promise<void>;

export const allowAllWrites: WriteGuard = () => undefined;

export interface DocsWorkspace {
  readonly workspaceRoot: string;
  readonly projection: ProjectionDb;
  readonly git: AutoCommitter;
  readonly selfWrites: SelfWriteRegistry;
  readonly bus: InvalidationBus;
  readonly logger: Logger;
  readonly now: () => number;
  /**
   * Defaults to {@link allowAllWrites}. `createServer` supplies the real one —
   * `locks/guard.ts`'s `assertWritable`, which turns the other party's live
   * lease into the contract's `423` (SPEC.md §7).
   */
  readonly assertWritable?: WriteGuard | undefined;
}

/** A 400 always carries `issues` — `ApiErrorSchema`'s `bad_request` variant requires it. */
export function validationError(message: string, issues: readonly ValidationIssue[]): never {
  throw badRequest(message, issues.length > 0 ? [...issues] : [{ path: "", message }]);
}

/**
 * Run the §14 validator over the document a mutation is about to write, and
 * return the warnings its response must carry. Only the single-document rules
 * can *block* (see {@link LOCAL_CHECK_CODES}); an anchor that no longer resolves
 * and a `[[ref]]` to a document that does not exist are warnings and never block
 * the save, because §14 carves both out explicitly as normal states of a living
 * corpus.
 *
 * The `[[ref]]` rule is why this needs the projection. The checker is handed one
 * file, so "does the target exist" is unanswerable from that set alone — without
 * the corpus the projection already indexes, every cross-document reference in
 * the saved file would warn.
 */
export function validateBeforeWrite(
  workspace: Pick<DocsWorkspace, "logger" | "projection">,
  path: string,
  text: string,
): Warning[] {
  const report = checkCorpus([toCheckDocument(path, text)], {
    resolveAnchor: resolveAnchorExact,
    documentExists: (id) => isIdTaken(workspace.projection, id),
  });
  // §7's skill and agent-definition roots legitimately hold files with no
  // Corpus frontmatter at all — a hand-written `SKILL.md` carries Claude Code's
  // `name`/`description` and nothing else, which is why the projection
  // synthesizes an id for them. Demanding §5's canonical block there would make
  // archiving one impossible; every *structural* rule still applies.
  const lenientFrontmatter = classifyPath(path)?.synthesizeId === true;
  const blocking = report.errors.filter(
    (finding) =>
      LOCAL_CHECK_CODES.has(finding.code) &&
      !(lenientFrontmatter && finding.code === CHECK_CODES.frontmatterInvalid),
  );
  if (blocking.length > 0) {
    validationError(
      `the document would not pass validation: ${blocking[0]?.detail ?? "invalid document"}`,
      blocking.map((finding) => ({ path: finding.code, message: finding.detail })),
    );
  }
  if (report.warnings.length > 0) {
    workspace.logger.info("document saved with validation warnings", {
      path,
      warnings: report.warnings.map((finding) => `${finding.code}: ${finding.detail}`),
    });
  }
  const warnings: Warning[] = [];
  for (const finding of report.warnings) {
    const code = WARNING_CODE_BY_CHECK[finding.code];
    if (code !== undefined) warnings.push({ code, detail: finding.detail });
  }
  return warnings;
}

/**
 * The folder a `folder` field names, as a workspace-relative path under
 * `data/docs/`, or a 400.
 *
 * The contract's grammar is "a bare name (`finance`) or the full prefix
 * (`data/docs/finance`)" — an absolute path is neither, so it is refused rather
 * than silently reinterpreted as a relative one. Everything that could escape
 * the document root is refused by the core normalizer.
 */
export function resolveFolder(folder: string | undefined): string {
  const trimmed = folder?.trim();
  if (trimmed !== undefined && (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed))) {
    validationError("folder must be a path under data/docs", [
      { path: "folder", message: `${folder ?? ""} is an absolute path, not a folder name` },
    ]);
  }
  try {
    return normalizeDocFolder(folder);
  } catch (error) {
    if (error instanceof PathTraversalError) {
      validationError("folder escapes the document root", [
        { path: "folder", message: `${folder ?? ""} is not a folder under data/docs` },
      ]);
    }
    throw error;
  }
}

/** Every path an operation touches, for the containment guard. */
const operationPaths = (operation: FileOperation): readonly string[] => {
  switch (operation.kind) {
    case "write":
    case "remove":
      return [operation.path];
    case "renameFile":
    case "renameDir":
      return [operation.from, operation.to];
  }
};

/**
 * Refuse a path that leaves the workspace once symlinks are followed.
 *
 * String arithmetic alone is not containment: `data/docs/elsewhere` may be a
 * symlink to `/etc`, and writing "inside `data/`" would then write outside the
 * workspace entirely. Resolution walks up to the nearest ancestor that exists,
 * because the leaf of a create does not exist yet — its *parent* is what the
 * write follows.
 */
export function assertContained(workspaceRoot: string, path: string): void {
  const root = realpathSync(workspaceRoot);
  let current = resolve(workspaceRoot, path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const real = realpathSync(current);
  if (real !== root && !real.startsWith(`${root}${sep}`)) {
    validationError("the path escapes the workspace", [
      { path: "path", message: `${path} resolves outside the workspace` },
    ]);
  }
}

/**
 * Write `text` at `absPath` so no reader ever observes a partial document: a
 * temp file in the same directory, flushed to the platform, then renamed over
 * the target (atomic within a directory on every platform Corpus targets) and
 * the directory itself flushed so the rename survives a crash.
 *
 * The temp name is dot-prefixed, which is exactly what the watcher's
 * `isIgnoredEntry` and the projection's own walk skip — so a concurrent scan
 * can never see it as a document, and no `*.tmp` file is ever created under
 * `data/`.
 */
export function writeFileAtomically(absPath: string, text: string): void {
  const directory = dirname(absPath);
  mkdirSync(directory, { recursive: true });
  const tmpPath = join(directory, `.tmp-${process.pid}-${randomBytes(6).toString("hex")}.md`);
  try {
    const handle = openSync(tmpPath, "wx");
    try {
      writeSync(handle, text, null, "utf8");
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(tmpPath, absPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
  try {
    const handle = openSync(directory, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  } catch {
    // Directory fsync is unsupported on some platforms; the rename already
    // happened and the data is flushed. Not worth failing a mutation over.
  }
}

const abs = (workspace: DocsWorkspace, path: string): string =>
  resolve(workspace.workspaceRoot, path);

/**
 * Declare every path a plan is about to touch, **before** any of it lands. The
 * watcher can see a write the instant it happens, and an entry recorded
 * afterwards loses that race — which surfaces as a spurious out-of-band
 * reconciliation, i.e. as an anchor bug that is not one.
 */
function registerSelfWrites(workspace: DocsWorkspace, operation: FileOperation): void {
  switch (operation.kind) {
    case "write":
      workspace.selfWrites.record(abs(workspace, operation.path), operation.content);
      return;
    case "remove":
      workspace.selfWrites.record(abs(workspace, operation.path), null);
      return;
    case "renameFile":
      workspace.selfWrites.record(abs(workspace, operation.from), null);
      workspace.selfWrites.record(abs(workspace, operation.to), operation.content);
      return;
    case "renameDir":
      for (const path of operation.documents) {
        workspace.selfWrites.record(abs(workspace, path), null);
      }
      return;
  }
}

/** Restores what one applied operation replaced; see {@link applyOperation}. */
type Undo = () => void;

/**
 * Put a path back the way it was found. `previous` is `null` for a path that did
 * not exist, which is undone by removing whatever the operation created.
 */
function restore(workspace: DocsWorkspace, path: string, previous: string | null): void {
  const target = abs(workspace, path);
  if (previous === null) {
    workspace.selfWrites.record(target, null);
    rmSync(target, { force: true });
    return;
  }
  workspace.selfWrites.record(target, previous);
  writeFileAtomically(target, previous);
}

const readIfPresent = (absPath: string): string | null =>
  existsSync(absPath) ? readFileSync(absPath, "utf8") : null;

function applyOperation(workspace: DocsWorkspace, operation: FileOperation): Undo {
  switch (operation.kind) {
    case "write": {
      const target = abs(workspace, operation.path);
      const previous = readIfPresent(target);
      writeFileAtomically(target, operation.content);
      return () => {
        restore(workspace, operation.path, previous);
      };
    }
    case "remove": {
      const target = abs(workspace, operation.path);
      const previous = readIfPresent(target);
      rmSync(target, { force: true });
      return () => {
        restore(workspace, operation.path, previous);
      };
    }
    case "renameFile": {
      const target = abs(workspace, operation.to);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(abs(workspace, operation.from), target);
      return () => {
        workspace.selfWrites.record(target, null);
        workspace.selfWrites.record(abs(workspace, operation.from), operation.content);
        renameSync(target, abs(workspace, operation.from));
      };
    }
    case "renameDir": {
      const target = abs(workspace, operation.to);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(abs(workspace, operation.from), target);
      return () => {
        renameSync(target, abs(workspace, operation.from));
      };
    }
  }
}

/** First lines of a hook's output — enough to recognise which hook refused. */
export function warningDetail(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, WARNING_DETAIL_LINES)
    .join("\n")
    .slice(0, WARNING_DETAIL_LENGTH);
}

function warningsFor(outcome: CommitOutcome | null): Warning[] {
  if (outcome === null) return [];
  if (outcome.kind === "failed") {
    return [
      { code: "commit_failed", detail: `${outcome.reason}: ${warningDetail(outcome.output)}` },
    ];
  }
  // "nothing to commit" is not a degraded state — it is the pipeline agreeing
  // with itself that a save changed no committed bytes.
  if (outcome.kind === "skipped" && outcome.reason !== "nothing to commit") {
    return [{ code: "commit_skipped", detail: outcome.reason }];
  }
  return [];
}

/**
 * Serializes writes per document. One in-process writer exists by Decision 2,
 * so an in-process promise chain is the whole mechanism: the second `PUT` to a
 * document reads the first one's result off disk, which is what makes
 * reconciliation chain correctly instead of racing.
 */
export interface DocumentMutex {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export function createDocumentMutex(): DocumentMutex {
  const chains = new Map<string, Promise<unknown>>();
  return {
    run(key, task) {
      const previous = chains.get(key) ?? Promise.resolve();
      const result = previous.then(task, task);
      const settled = result.then(
        () => undefined,
        () => undefined,
      );
      chains.set(key, settled);
      void settled.then(() => {
        // Drop the chain once it is the tail, so a workspace with many
        // documents does not accumulate one resolved promise per id forever.
        if (chains.get(key) === settled) chains.delete(key);
      });
      return result;
    },
  };
}

/**
 * Lane keys that are not document ids. Both begin with U+0000, which no id and
 * no path can contain, so a reserved lane can never be shadowed by a real
 * document. Written as an escape rather than as a raw byte: a literal NUL in a
 * source file makes git's own heuristics call it binary once it lands in the
 * first few kilobytes, and an invisible control character is not something a
 * reviewer should have to hexdump for.
 *
 * {@link CREATE_LANE} is the key creates serialize under — two concurrent
 * creates can choose the same filename before either has written it, so they
 * take one lane, while edits to distinct documents never contend.
 * {@link SEEN_LANE} is the same idea for `.corpus/seen.json`, which is one
 * file for the whole workspace and therefore one lane (SPEC.md §7).
 */
export const CREATE_LANE = "\u0000create";
export const SEEN_LANE = "\u0000seen";

/**
 * Hold several lanes at once, for a mutation that writes more than one
 * document — a thread whose deletion also rewrites its parent's `anchors` map
 * (SPEC.md §6).
 *
 * **Acquisition order is the deadlock discipline**, and it is the caller's to
 * respect: every composite thread mutation passes `[threadId, parentId]`, in
 * that order, and nothing anywhere takes the two the other way round.
 * Duplicates are collapsed, so a (corrupt) thread naming itself as its own
 * parent waits on itself exactly zero times.
 */
export function runInLanes<T>(
  mutex: DocumentMutex,
  keys: readonly (string | null | undefined)[],
  task: () => Promise<T>,
): Promise<T> {
  const lanes = [
    ...new Set(keys.filter((key): key is string => key !== null && key !== undefined)),
  ];
  const enter = (index: number): Promise<T> => {
    const key = lanes[index];
    return key === undefined ? task() : mutex.run(key, () => enter(index + 1));
  };
  return enter(0);
}

export async function runMutation(
  workspace: DocsWorkspace,
  request: {
    readonly docId: string;
    readonly actor: Actor;
    readonly plan: MutationPlan;
    /**
     * What {@link validateBeforeWrite} already noticed about the bytes this plan
     * writes. Carried in rather than recomputed here: the pipeline has no
     * document text of its own, and validation happens before the write by
     * design.
     */
    readonly warnings?: readonly Warning[];
  },
): Promise<MutationResult> {
  const { plan } = request;
  const validationWarnings = request.warnings ?? [];
  if (plan.operations.length === 0) {
    return { changed: false, warnings: validationWarnings, commit: null };
  }

  // Containment is checked for every path of every verb in one place, before
  // any of them is acted on: a plan that would escape the workspace leaves it
  // byte-for-byte untouched.
  for (const operation of plan.operations) {
    for (const path of operationPaths(operation)) {
      assertContained(workspace.workspaceRoot, path);
    }
  }

  // A plan that touches more than one path is all-or-nothing. Anchored thread
  // creation writes the parent's frontmatter *and* the new thread file
  // (SPEC.md §6, SERVER-006); a failure between the two would leave an anchor
  // pointing at a conversation that does not exist — the one state §6 says must
  // never be observable. A single-operation plan needs nothing: every write
  // here is a rename over the target, so it either landed whole or not at all.
  const undo: Undo[] = [];
  try {
    for (const operation of plan.operations) {
      registerSelfWrites(workspace, operation);
      undo.push(applyOperation(workspace, operation));
    }
  } catch (error) {
    for (const rollback of undo.reverse()) {
      try {
        rollback();
      } catch (rollbackError) {
        // The mutation already failed; a failed rollback is worse news, not a
        // different outcome. Report it and keep unwinding the rest.
        workspace.logger.error("could not roll back a partial mutation", {
          docId: request.docId,
          error: String(rollbackError),
        });
      }
    }
    throw error;
  }

  const commit =
    plan.commit === null
      ? null
      : await workspace.git.commit({
          docId: request.docId,
          actor: request.actor,
          subject: plan.commit.subject,
          paths: plan.stage,
          ...(plan.commit.anchors === undefined ? {} : { anchors: plan.commit.anchors }),
        });

  // After the commit and before the response — a hook failure must not cost the
  // projection its update, or the UI would stop showing a change that is on disk.
  for (const path of plan.unproject) {
    removeDocument(workspace.projection, abs(workspace, path));
  }
  for (const path of plan.project) {
    if (classifyPath(path) === null) continue;
    projectDocument(workspace.projection, abs(workspace, path));
  }

  workspace.bus.invalidate(dedupeKeys(plan.keys));

  return { changed: true, warnings: [...validationWarnings, ...warningsFor(commit)], commit };
}
