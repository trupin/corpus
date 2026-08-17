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
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeSync,
  type Stats,
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
  type CheckFinding,
  type CheckOptions,
} from "../core/index.js";
import { resolveAnchorExact } from "../anchors/index.js";
import type { EditSessionTracker } from "../edit/index.js";
import { rosterSignature } from "../agents/roster.js";
import { HttpError, badRequest } from "../errors.js";
import type { InvalidationBus } from "../events/index.js";
import { AGENTS_KEY, TREE_KEY, dedupeKeys } from "../events/index.js";
import type { AnchorChange, AutoCommitter, CommitOutcome } from "../git/index.js";
import type { Logger } from "../logger.js";
import {
  DOCUMENT_ROOTS,
  classifyPath,
  projectDocument,
  removeDocument,
} from "../projection/index.js";
import type { DocumentRoot, ProjectionDb } from "../projection/index.js";
import type { SelfWriteRegistry } from "../watcher/index.js";
import { anchorClaimantIds, isIdTaken } from "./read.js";
import { folderTreeSignature } from "./tree.js";

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
 * The §14 errors a single file *also* decides on its own but that a save
 * deliberately does not refuse — reported to the log by
 * {@link validateBeforeWrite} instead of thrown (SERVER-066 review, finding B).
 *
 * Two sets rather than one because "decidable from this file" and "worth
 * refusing the write for" are different questions, and `unterminated-fence` is
 * the first code to answer them differently: it is a property of the body's
 * bytes and of nothing else, yet blocking on it would make a document that
 * already carries an unclosed fence unwritable — the user's reply and the
 * agent's own repair attempt included (see {@link checkUnterminatedFence} in
 * `core/check.ts`). So it is neither refused nor discarded: it is said out loud.
 *
 * **`anchor-unused` is deliberately not a member, and it is the reason this is a
 * list rather than "every error that is not blocking".** It is a cross-document
 * rule answered here through the projection, and during a multi-file mutation
 * the projection is one write behind by construction: anchored thread creation
 * validates the parent document carrying the *new* anchor entry immediately
 * before writing the thread that claims it (`threads/create.ts`, and the same in
 * `capture.ts`), so the seam truthfully reports that nothing claims it yet.
 * Measured across the server suite, that is every anchored comment in the
 * product — a finding that is false on the commonest path in the system, and
 * logging it would train the reader to skip the channel that the fence finding
 * needs them to read. The whole-corpus `corpus doc check` has no such blind
 * spot, and remains where a genuinely dangling anchor is reported.
 *
 * A code added to neither set is therefore silent on the save path, which is the
 * safe default. `write.test.ts` pins both directions: the fence reaches the log,
 * and the parent text `threads/create.ts` produces does not.
 */
const REPORTED_CHECK_CODES: ReadonlySet<CheckCode> = new Set([CHECK_CODES.unterminatedFence]);

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

/**
 * The seams §14's validator is given on this server, in one expression because
 * there are two call sites for it and they must not drift: this file's
 * {@link checkSave}, which validates the bytes a mutation is about to write, and
 * `POST /api/check`, which validates whatever a caller submits. §14's promise is
 * that they are "the same validator", and a seam supplied by one and forgotten by
 * the other is precisely how that stops being true — without the resolver no
 * orphaned anchor is ever reported, without `documentExists` every `[[ref]]` to
 * an unsubmitted document warns, and without `anchorClaimants` every *anchored*
 * document fails a subset check with a dangling-highlight error the write path
 * would never raise (sprint-013 Adjudication 6).
 *
 * Both projection seams answer about the **live corpus** and are unioned with the
 * submitted set by `checkCorpus`, which asks them only about what the set cannot
 * settle on its own. That makes one expression correct for a whole-corpus check,
 * for a single save, and for the handful of unsaved `(path, content)` pairs
 * `corpus doc check --staged` sends.
 */
export const checkSeams = (projection: ProjectionDb): CheckOptions => ({
  // The §6 exactness tier — the same call `docs/read.ts` and the projector
  // make. §14's `orphaned_anchor` warning has to mean what the reader means by
  // orphaned, or a save reports a detached thread the board then draws a
  // highlight for (and, wired the other way round, warns about none while the
  // board draws the highlight on a lookalike).
  resolveAnchor: resolveAnchorExact,
  documentExists: (id) => isIdTaken(projection, id),
  anchorClaimants: (docId, anchorId) => anchorClaimantIds(projection, docId, anchorId),
});

/**
 * True for the one finding this system deliberately does not hold against a
 * document: §5's canonical frontmatter block, demanded of a file under §7's skill
 * or agent-definition roots.
 *
 * Those roots legitimately hold files with no Corpus frontmatter at all — a
 * hand-written `SKILL.md` carries Claude Code's `name`/`description` and nothing
 * else, which is why the projection synthesizes an id for them. Every *structural*
 * rule still applies; only this one is waived.
 *
 * It is a predicate over a finding rather than a flag computed at a call site so
 * that the save path and `POST /api/check` cannot disagree: **a document the
 * system accepts on write must not fail a check** (sprint-013 Adjudication 6).
 * Waived, never re-graded — moving it to `warnings` would put a code outside
 * §14's closed two-member warning set on the wire.
 */
export function isSkillFrontmatterException(finding: Pick<CheckFinding, "code" | "path">): boolean {
  return (
    finding.code === CHECK_CODES.frontmatterInvalid &&
    classifyPath(finding.path)?.synthesizeId === true
  );
}

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
   *
   * A destination that already exists is **merged into**, file by file, rather
   * than refused (see {@link mergeDirectory}); the caller is responsible for
   * having established that no file collides — `docs/archive.ts` does that at
   * plan time so the refusal happens before anything is written.
   */
  | {
      readonly kind: "renameDir";
      readonly from: string;
      readonly to: string;
      readonly documents: readonly string[];
    };

/**
 * How a plan that **is one of SPEC.md §4's acts** meets the open commit window
 * (SERVER-092). An act is "a change someone else can act on, as against a body
 * edit that is merely underway", and §4 gives it one of two shapes:
 *
 * - `"names-the-window"` — an agent turn, a thread resolved or reopened, a
 *   document archived, restored, moved, renamed or marked still current. "The
 *   act's own change is the **last thing in the window's commit**, and the
 *   commit's subject names the act": the write folds into the open window as
 *   usual, and *then* the window closes, keeping that subject instead of being
 *   relabelled an editing session.
 * - `"commits-alone"` — a deletion and a staged bulk Save, §4's "two acts commit
 *   alone". The order is the other way round: the window closes and lets its commit land **first**, and the act's
 *   own commit then stands by itself, folding in neither direction.
 *
 * Getting that asymmetry backwards produces the right number of commits in the
 * wrong order, so both directions are asserted rather than assumed
 * (`acts.test.ts`).
 *
 * Declared on the plan rather than called at each verb because `MutationPlan`
 * is where the subject that names the act already lives: eleven scattered
 * `closeWindow()` calls would drift the moment someone adds a verb, and a
 * reviewer checking §4's two lists against the diff would have eleven places to
 * look instead of one.
 */
export type ActCommit = "names-the-window" | "commits-alone";

export type MutationPlan = {
  readonly operations: readonly FileOperation[];
  /** Workspace-relative paths (files or directories) the commit stages. */
  readonly stage: readonly string[];
  /** Document files whose rows must be rebuilt after the write. */
  readonly project: readonly string[];
  /** Document files whose rows must be dropped after the write. */
  readonly unproject: readonly string[];
  readonly commit: {
    readonly subject: string;
    readonly anchors?: AnchorChange | undefined;
    /**
     * `false` opts this plan out of §4's per-session folding. Left unset — the
     * default — by every edit verb, because folding repeated saves of one
     * document by one author into one commit is exactly what §4 asks for.
     *
     * The anchor re-attach sets it, and the reason generalises to any repair: a
     * repair is not a continuation of the edit that made it necessary, it is the
     * answer to it. Folding one into the other would amend the bad edit's commit
     * out of existence — destroying the very history the repair is reading, and
     * leaving `git log` with no record that the repair happened at all.
     */
    readonly squash?: boolean | undefined;
    /**
     * Set by the plans that are one of SPEC.md §4's *acts*, and by nothing else
     * — see {@link ActCommit}. Left unset by an ordinary save of a document
     * body, whichever document it is to, which is the first entry on §4's "what
     * does **not** close a window" list.
     */
    readonly act?: ActCommit | undefined;
  } | null;
  readonly keys: readonly QueryKey[];
  /**
   * Set by any plan whose write *could* change the `data/docs/` folder tree —
   * a create, a move, a delete, an archive, a status edit. `runMutation` then
   * appends `TREE_KEY` to the frame **iff `GET /api/tree`'s answer actually
   * changed**, by comparing {@link folderTreeSignature} either side of the
   * projection.
   *
   * That comparison is the whole point, and it is why no write site pushes
   * `TREE_KEY` by hand: "does this mutation move a folder badge" has no
   * answer at the call site. A parented thread counts in its parent's folder
   * and a standalone one counts nowhere; an archived document counts nowhere
   * but its threads still do; deleting a document silently un-counts every
   * thread hanging from it; moving a thread-less archived document changes
   * nothing at all. Every one of those was either announced when nothing had
   * changed or changed without being announced while the key was a literal in
   * the key list (SERVER-018).
   *
   * Left unset — the default — for the writes that provably cannot touch the
   * tree (a body edit, a turn, mark-seen), which also keeps the extra tree
   * query off the autosave path.
   */
  readonly mayChangeTree?: boolean;
  /**
   * The workspace-relative path of the document this plan is the **editor's
   * save** of (SPEC.md §4's edit acknowledgment; SERVER-052). Set by
   * `PUT /api/docs/{id}`, and only when that save changes the **body** — a user
   * save of a document's prose is what §4 means by an edit session, and that
   * verb is where the reader's autosave and the plugin read-modify-write both
   * land.
   *
   * Left unset by every other verb on purpose. A create, a move, an archive, a
   * delete and a thread turn are all things that *happen to* a document rather
   * than sessions of somebody editing it; folding them in
   * would acknowledge a document the user only filed, and would double up with
   * the `comment.created` a thread reply already enqueues. It is left unset for
   * the same reason by a `PUT` that moves only frontmatter — a column width, a
   * tag, a status — which is a thing that happens to a document too, and has no
   * prose for §4's reflection to be about (SERVER-095).
   *
   * Carrying the path rather than a boolean is what lets the tracker report
   * stats path-scoped to this file and follow a document renamed between saves.
   */
  readonly editSession?: string | undefined;
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

export interface DocsWorkspace {
  readonly workspaceRoot: string;
  readonly projection: ProjectionDb;
  readonly git: AutoCommitter;
  readonly selfWrites: SelfWriteRegistry;
  readonly bus: InvalidationBus;
  readonly logger: Logger;
  readonly now: () => number;
  /**
   * Absolute path of `.corpus/attachments` (SPEC.md §6, SERVER-010). Present on
   * the *document* workspace rather than only the thread one because deleting a
   * thread is `DELETE /api/docs/{id}` — one deletion path, so the cleanup hook
   * has to hang where that path can reach it. `undefined` in tests that store
   * no bytes, where every cleanup call is a no-op.
   */
  readonly attachmentsRoot?: string | undefined;
  /**
   * §4's edit acknowledgment (SERVER-052). Every mutation is reported to it —
   * not only the editor's saves — because a commit by the *other* party is what
   * seals an open session, and a tracker that never heard about one could hand
   * the agent a range spanning the agent's own commit.
   *
   * A seam, and optional: the pipeline stays testable without a queue, and a
   * server built without a projection (and so without a git writer) has no
   * acknowledgment to make.
   */
  readonly editSessions?: EditSessionTracker | undefined;
  /**
   * §9.2's provenance lookup (SERVER-110): resolves the `job` a write names to
   * the thread that work came from, so the document can be stamped with it.
   *
   * A seam, and optional, for the same reason {@link editSessions} is — the
   * write pipeline is testable without a queue, and a server built without one
   * has no job to resolve. When it is absent a write naming a job is **not**
   * refused: it simply records no origin, which is exactly what §9.2 says a
   * write that names no job does. Forgetting costs provenance, never
   * correctness, and a server with no queue is the same case as a caller with
   * no job.
   */
  readonly jobs?: JobLookup | undefined;
}

/** What a resolved job says about where its work belongs. */
export type JobOrigin =
  | { readonly ok: true; readonly origin: string | null }
  | { readonly ok: false; readonly reason: "unknown" | "settled"; readonly status?: string };

/**
 * Resolves a `job` id to the thread its work came from (SERVER-110).
 *
 * Synchronous by design: the write path already holds a document lane, and an
 * `await` inside it is a window for another writer. The queue's own event read
 * is a single file read, so there is nothing here worth going async for.
 */
export interface JobLookup {
  originFor(job: string): JobOrigin;
}

/** A 400 always carries `issues` — `ApiErrorSchema`'s `bad_request` variant requires it. */
export function validationError(message: string, issues: readonly ValidationIssue[]): never {
  throw badRequest(message, issues.length > 0 ? [...issues] : [{ path: "", message }]);
}

/**
 * The refusal raised when the **destination path** is already taken — a move
 * onto an existing filename, a skill archived into a folder that already exists.
 * Byte-for-byte the `400` {@link validationError} raises; the type is the only
 * thing added.
 *
 * It exists because the two planners that raise it (`planMove`,
 * `planSetArchived`) are shared between a single-document route and the bulk act
 * (SERVER-077), and the two need different things from the same condition. On
 * its own route it is a `400` and nothing more. Inside a bulk act the *class* of
 * refusal is decided by which step failed, and everything `planFor` raises would
 * otherwise be reported as `not-applicable` — whose published meaning is "the
 * act does not apply to this document … the corpus changed between selecting and
 * acting", i.e. *refresh the board*, when the remedy for a filename collision is
 * to rename something (SERVER-077 review, finding 4). Nothing about the error
 * message could tell them apart, so the type carries it: this was refused by the
 * path, not by the act.
 */
export class DestinationOccupiedError extends HttpError {}

/** {@link validationError}, for a destination that is already taken. */
export function destinationOccupied(message: string, issues: readonly ValidationIssue[]): never {
  throw new DestinationOccupiedError(400, {
    code: "bad_request",
    message,
    issues: issues.length > 0 ? [...issues] : [{ path: "", message }],
  });
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
export type SaveCheck = {
  /** Empty exactly when {@link validateBeforeWrite} would let these bytes through. */
  readonly blocking: readonly CheckFinding[];
  /**
   * What this save is letting through and still reporting, verbatim and at the
   * severity §14 gives it: the two warnings, **and the errors in
   * {@link REPORTED_CHECK_CODES}**.
   *
   * That second half used to be dropped here (this field was literally
   * `report.warnings`), which made the non-blocking error family unobservable on
   * the write path: computed on every save and discarded, so
   * `unterminated-fence` — a rule whose entire purpose is that a swallowed turn
   * stops being silent — surfaced only if somebody later ran `corpus doc check`
   * by hand, i.e. never on the path the bug happens on (SERVER-066 review,
   * finding B).
   */
  readonly findings: readonly CheckFinding[];
  /**
   * Those findings translated into the §14 response warnings a mutation carries
   * — the two-member set and nothing else. An error the save let through has no
   * `WarningCode` to be reported under, and inventing one would put an
   * error-severity finding into the wire's *warning* channel; it reaches the
   * operator through {@link validateBeforeWrite}'s log instead.
   */
  readonly warnings: readonly Warning[];
};

/**
 * The §14 validator, run over the bytes a save would write, without throwing.
 *
 * Split out of {@link validateBeforeWrite} because callers legitimately need to
 * ask "would saving these bytes be accepted?" without a save being underway, and
 * a predicate spelled with a `try`/`catch` around a throwing validator would be a
 * second definition of "valid".
 */
export function checkSave(projection: ProjectionDb, path: string, text: string): SaveCheck {
  const report = checkCorpus([toCheckDocument(path, text)], checkSeams(projection));
  const blocking = report.errors.filter(
    (finding) => LOCAL_CHECK_CODES.has(finding.code) && !isSkillFrontmatterException(finding),
  );
  // Errors this save lets through and still reports (see REPORTED_CHECK_CODES).
  const tolerated = report.errors.filter((finding) => REPORTED_CHECK_CODES.has(finding.code));
  const warnings: Warning[] = [];
  for (const finding of report.warnings) {
    const code = WARNING_CODE_BY_CHECK[finding.code];
    if (code !== undefined) warnings.push({ code, detail: finding.detail });
  }
  return { blocking, findings: [...tolerated, ...report.warnings], warnings };
}

export function validateBeforeWrite(
  workspace: Pick<DocsWorkspace, "logger" | "projection">,
  path: string,
  text: string,
): Warning[] {
  const { blocking, findings, warnings } = checkSave(workspace.projection, path, text);
  if (blocking.length > 0) {
    validationError(
      `the document would not pass validation: ${blocking[0]?.detail ?? "invalid document"}`,
      blocking.map((finding) => ({ path: finding.code, message: finding.detail })),
    );
  }
  // The two families are logged apart, and the error one is logged through
  // `logger.error` on purpose: that is the level the logger never gates, and a
  // §14 *error* the save let through is precisely what must not be silenced —
  // an unterminated fence in a thread is destroying turns as it is written, and
  // "silence is why a user had to notice their own reply had vanished". The
  // response cannot carry it (see {@link SaveCheck.warnings}), so this line is
  // the surface, and it costs no contract change to have.
  const failed = findings.filter((finding) => finding.severity === "error");
  if (failed.length > 0) {
    workspace.logger.error("document saved with validation errors", {
      path,
      errors: failed.map((finding) => `${finding.code}: ${finding.detail}`),
    });
  }
  const advisory = findings.filter((finding) => finding.severity === "warning");
  if (advisory.length > 0) {
    workspace.logger.info("document saved with validation warnings", {
      path,
      warnings: advisory.map((finding) => `${finding.code}: ${finding.detail}`),
    });
  }
  return [...warnings];
}

/**
 * A filename that stands for "any document written here" when asking
 * {@link classifyPath} whether the projection would index a folder's contents.
 *
 * The question is about the *folder*, but `classifyPath` classifies whole paths,
 * so the probe supplies the only other thing a path needs. It is deliberately an
 * ordinary slug: `slugifyTitle` can never produce a leading dot (it strips
 * everything but `a-z0-9-`), so no real filename can make the answer differ from
 * this one.
 */
const FOLDER_PROBE_FILENAME = "document.md";

/**
 * Whether the projection would index a document written into `folder` — asked of
 * {@link classifyPath} itself rather than of a copy of its rules (SERVER-037).
 *
 * `classifyPath` skips a path with any segment that `startsWith(".")` or that
 * names an ignored directory (`projection/roots.ts`), and a folder made of such
 * segments used to produce the worst outcome the write path has: the file was
 * written, auto-committed, and then never indexed, so the create route answered
 * `404 no document with id …` for a document that exists in git and on disk and
 * on no read surface. Both halves of that skip condition reproduce it, so the
 * refusal covers both — and it covers them by *calling the function*, so a name
 * added to the projection's ignore list is refused here the same day without a
 * second list to remember to update.
 */
const projectionIndexesFolder = (folder: string): boolean =>
  classifyPath(`${folder}/${FOLDER_PROBE_FILENAME}`) !== null;

/**
 * The document roots a create may name **outright**, by their declared path —
 * every root SPEC.md §7 adds "alongside `data/`" (SERVER-122).
 *
 * Read out of {@link DOCUMENT_ROOTS} rather than listed here, so a root declared
 * later is creatable the same day and no second list can drift from the
 * projection's. The `data/` roots are excluded because the `folder` grammar is
 * *already* rooted at `data/docs/` — `normalizeDocFolder` owns every spelling
 * under it, including the escapes — and a second door onto the same place would
 * be two rules for one path.
 *
 * Membership is not permission: naming a root here only makes it *reachable*.
 * {@link resolveFolder} still asks the root what it holds (its declared `type`)
 * and asks {@link projectionIndexesFolder} whether an ordinary `*.md` written
 * there would be indexed at all — which is what keeps `.claude/skills` refused,
 * since that root indexes `SKILL.md` files alone and has its own verb
 * (`POST /api/skills`).
 */
const NAMEABLE_ROOTS: readonly DocumentRoot[] = DOCUMENT_ROOTS.filter(
  (root) => !root.path.startsWith("data/"),
);

/**
 * The nameable root `folder` spells out, or `null`.
 *
 * The declared path **exactly**, never a folder beneath one. Nothing is lost by
 * that — every nameable root is flat or `SKILL.md`-shaped, so a subfolder is
 * something the projection would not index anyway — and it is what keeps this
 * grammar clear of traversal altogether: a `folder` carrying `..` matches no
 * root's path, so it falls through to `normalizeDocFolder` and is judged there
 * by the same code, in the same words, as before this root existed
 * (SERVER-122). That matters because normalization and prefix-matching disagree
 * — `.claude/agents/../../etc` *is* `data/docs/etc` — and a matcher that ran
 * first would answer for a path the caller did not name.
 */
const namedRoot = (folder: string): DocumentRoot | null =>
  NAMEABLE_ROOTS.find((root) => root.path === folder) ?? null;

/**
 * A root a request named, or the 400 explaining why a document cannot be
 * created there.
 *
 * Both refusals are questions put to the root's own declaration rather than to
 * a list kept here: what type it holds, which is the type it *overrides* every
 * file under it to (a `note` filed in `.claude/agents/` would be indexed as an
 * `agent-def` — the caller would not get the document they asked for), and
 * whether the projection indexes an ordinary `*.md` written there at all.
 */
function admitRoot(root: DocumentRoot, spelled: string, forType: string | undefined): string {
  if (root.type !== null && root.type !== forType) {
    validationError("that root holds one kind of document, and this is not it", [
      {
        path: "folder",
        message:
          `${spelled} indexes every file under it as \`type: ${root.type}\`, so a ` +
          `\`${forType ?? "note"}\` filed there would not be the document you asked for`,
      },
    ]);
  }
  if (!projectionIndexesFolder(root.path)) {
    validationError("folder is not a location documents are indexed from", [
      {
        path: "folder",
        message:
          `${spelled} is a document root, but it does not index an ordinary \`*.md\` file ` +
          "written into it, so a document filed there could never be read back",
      },
    ]);
  }
  return root.path;
}

/**
 * The root a document of `type` is created in when the request names no folder
 * — §7's "additional document roots", each of which declares the one type it
 * holds, or `null` for the ordinary inbox-first case.
 *
 * This is the spelling the product's own agent uses. `orchestrate/SKILL.md`
 * tells it that "a new `type: agent-def` document is all it takes to make a
 * persona addressable as `@<name>`", and Architecture Decision 2 confines it to
 * `corpus doc create` — so `--type agent-def` with no folder has to reach
 * `.claude/agents/`, or the instruction names something its only interface
 * cannot do (SERVER-122). An explicit `folder` always wins, which is what keeps
 * a document *about* an agent-def expressible: `--folder inbox` still files one
 * under `data/docs/`, exactly as `invocableName` already contemplates for
 * skills.
 */
const rootForType = (type: string | undefined): DocumentRoot | null =>
  type === undefined
    ? null
    : (NAMEABLE_ROOTS.find((root) => root.type === type && projectionIndexesFolder(root.path)) ??
      null);

/**
 * The folder a `folder` field names, as a workspace-relative path, or a 400.
 *
 * The contract's grammar is "a bare name (`finance`) or the full prefix
 * (`data/docs/finance`)" — an absolute path is neither, so it is refused rather
 * than silently reinterpreted as a relative one. Everything that could escape
 * the document root is refused by the core normalizer, and everything the
 * projection would refuse to index is refused by {@link projectionIndexesFolder}
 * — here, at validation time, ahead of the write pipeline, because a document
 * that is written and committed before anyone notices it is unreadable has
 * already damaged the audit trail (SERVER-037).
 *
 * `forType` extends that grammar with §7's other document roots, and only a
 * caller that supplies it can reach them: **a create may name a declared root
 * by its declared path** (`.claude/agents`), and a create that names no folder
 * at all lands in the root its `type` declares (see {@link rootForType}). Both
 * doors go through {@link NAMEABLE_ROOTS}, so neither can admit a place the
 * projection does not index. Omitting `forType` — which `move` and the bulk
 * act do, having no new type to file under — leaves the answer under
 * `data/docs/` exactly as it has always been.
 */
export function resolveFolder(folder: string | undefined, forType?: string): string {
  const trimmed = folder?.trim();
  if (trimmed === undefined || trimmed === "") {
    const implied = rootForType(forType);
    if (implied !== null) return implied.path;
  } else {
    const named = namedRoot(trimmed.replace(/\/+$/, ""));
    if (named !== null) return admitRoot(named, trimmed, forType);
  }
  if (trimmed !== undefined && (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed))) {
    validationError("folder must be a path under data/docs", [
      { path: "folder", message: `${folder ?? ""} is an absolute path, not a folder name` },
    ]);
  }
  let normalized: string;
  try {
    normalized = normalizeDocFolder(folder);
  } catch (error) {
    if (error instanceof PathTraversalError) {
      validationError("folder escapes the document root", [
        { path: "folder", message: `${folder ?? ""} is not a folder under data/docs` },
      ]);
    }
    throw error;
  }
  if (!projectionIndexesFolder(normalized)) {
    validationError("folder is not a location documents are indexed from", [
      {
        path: "folder",
        message:
          `${folder ?? ""} contains a folder name the corpus never indexes ` +
          "(a name starting with `.`, or an ignored directory such as `node_modules`), " +
          "so a document filed there could never be read back",
      },
    ]);
  }
  return normalized;
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
      // `lstat`, not `existsSync`: a symlink at the destination is something
      // that is *there*, and renaming onto it would replace it while merging
      // through it would put files wherever it points — neither is a move this
      // verb promises. `mergeCollision` refuses both before the plan is applied;
      // taking the same branch here keeps the two in step (PR #38, finding 5).
      if (lstatOrNull(target) !== null) {
        return mergeDirectory(abs(workspace, operation.from), target, operation.to);
      }
      mkdirSync(dirname(target), { recursive: true });
      renameSync(abs(workspace, operation.from), target);
      return () => {
        renameSync(target, abs(workspace, operation.from));
      };
    }
  }
}

/**
 * Everything under `absDir`, as paths relative to it — directories shallow-first
 * (so recreating them in order needs no `recursive`), files in walk order.
 *
 * `Dirent.isDirectory()` reflects `lstat`, so a symlink to a directory counts as
 * a file and is moved whole rather than descended into.
 */
function directoryContents(absDir: string): {
  readonly directories: readonly string[];
  readonly files: readonly string[];
} {
  const directories: string[] = [];
  const files: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(absDir, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        directories.push(child);
        walk(child);
      } else files.push(child);
    }
  };
  walk("");
  return { directories, files };
}

/**
 * What is at `path` without following a final symlink, or `null` when nothing
 * is. `existsSync` answers about the *target*, which is the wrong question for
 * a merge: a dangling symlink reports "nothing here" and is then silently
 * replaced, and a symlink to a directory reports "a directory" and is then
 * merged *through*, writing files outside the tree either end of the move names
 * (PR #38, finding 5). Only a user with filesystem access can plant either in
 * their own workspace, so this is not a security boundary — it is a silent-loss
 * path the plain rename did not have.
 */
const lstatOrNull = (path: string): Stats | null => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

/**
 * The first path under `fromAbs` whose counterpart under `toAbs` is in the way,
 * relative to the two roots — `""` when the destination *itself* is in the way,
 * or `null` when the two trees can be merged.
 *
 * Two real directories of the same name are not in the way: merging descends
 * into them. Anything else that already exists at the destination is, because
 * moving onto it would overwrite or fail — and refusing before a single byte is
 * written is what keeps `docs/archive.ts`'s refusal the one it advertises.
 */
export function mergeCollision(fromAbs: string, toAbs: string): string | null {
  const destination = lstatOrNull(toAbs);
  if (destination === null) return null;
  // A destination that is not a real directory is in the way whole: there is
  // nothing to descend into, and the merge below would either replace it or
  // follow it somewhere else entirely.
  if (!destination.isDirectory()) return "";
  const { directories, files } = directoryContents(fromAbs);
  for (const relative of files) {
    if (lstatOrNull(join(toAbs, relative)) !== null) return relative;
  }
  for (const relative of directories) {
    const target = lstatOrNull(join(toAbs, relative));
    if (target !== null && !target.isDirectory()) return relative;
  }
  return null;
}

/**
 * Move everything under `fromAbs` into an **existing** `toAbs`, file by file.
 *
 * `renameSync` cannot put a directory on top of a non-empty one, and refusing
 * outright is what made SERVER-078's wedge permanent: archiving a nested skill
 * on its own creates `.claude/skills-archived/<outer>/`, after which the outer
 * skill's archive could never be applied again and the only recovery was moving
 * a directory by hand. A merge is not a weaker guarantee — the caller has
 * already established that no file at the destination would be overwritten, so
 * the union is exactly the two disjoint trees, which for the case that produces
 * the wedge is the folder's own original shape reunited.
 *
 * Undone the same way it is done: the files go back, the directories this call
 * created at the destination are removed if they are still empty, and a failure
 * part-way through unwinds itself before re-throwing so a half-merged folder is
 * never left behind.
 *
 * **Both of its filesystem questions are asked again here, at the moment of the
 * write** (PR #38, findings 4a and 4b). `mergeCollision` answered them when the
 * plan was made, and the plain rename this replaced needed no such re-check
 * because the kernel performed the whole move in one call. A merge is many
 * calls, so anything that appears in between — an external editor's save, a
 * `corpus doc create` into the folder — falls in a window the rename did not
 * have. A file that has appeared at the destination is refused rather than
 * overwritten, and the source is emptied by `rmdir` from the bottom up rather
 * than by a recursive delete, so a file that has appeared under the *source*
 * fails loudly instead of being destroyed by a `force: true` that assumed the
 * skeleton was empty.
 *
 * `toRelative` is the destination as the workspace names it, carried in only so
 * a refusal can say which path is in the way in the same words the plan-time
 * one does.
 */
const occupied = (toRelative: string, relative: string): never =>
  destinationOccupied("the destination already holds a file this move would overwrite", [
    { path: "id", message: `${toRelative}/${relative} already exists; move or remove it first` },
  ]);

export function mergeDirectory(fromAbs: string, toAbs: string, toRelative: string): Undo {
  const { directories, files } = directoryContents(fromAbs);
  const created: string[] = [];
  const moved: string[] = [];

  const undo = (): void => {
    mkdirSync(fromAbs, { recursive: true });
    for (const relative of directories) mkdirSync(join(fromAbs, relative), { recursive: true });
    for (const relative of moved) renameSync(join(toAbs, relative), join(fromAbs, relative));
    for (const relative of [...created].reverse()) {
      try {
        rmdirSync(join(toAbs, relative));
      } catch {
        // Something else put content there; leaving it is the safe direction.
      }
    }
  };

  try {
    for (const relative of directories) {
      const target = join(toAbs, relative);
      const existing = lstatOrNull(target);
      if (existing !== null) {
        if (existing.isDirectory()) continue;
        occupied(toRelative, relative);
      }
      mkdirSync(target);
      created.push(relative);
    }
    for (const relative of files) {
      if (lstatOrNull(join(toAbs, relative)) !== null) occupied(toRelative, relative);
      renameSync(join(fromAbs, relative), join(toAbs, relative));
      moved.push(relative);
    }
    // Deepest first, and never recursively: every file was moved above, so each
    // of these is empty unless something appeared under the source since it was
    // enumerated — in which case `rmdir` refuses, and the unwind below puts the
    // move back rather than deleting a file nothing has committed.
    for (const relative of [...directories].reverse()) rmdirSync(join(fromAbs, relative));
    rmdirSync(fromAbs);
  } catch (error) {
    undo();
    throw error;
  }
  return undo;
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

export function commitWarnings(outcome: CommitOutcome | null): Warning[] {
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
 * (SPEC.md §6), or a bulk act over a whole selection (§4, SERVER-077).
 *
 * **Acquisition order is the deadlock discipline, and it is enforced here
 * rather than asked of the caller**: the keys are sorted, so every multi-lane
 * acquisition in the process takes its lanes in one global order and a cycle is
 * impossible. It used to be the caller's to respect — "every composite thread
 * mutation passes `[threadId, parentId]`, in that order" — which held only
 * while every such caller wrote two lanes it could name. A bulk act names an
 * arbitrary set, and `[parent, thread]` sorted against a deletion's
 * `[thread, parent]` is exactly the cycle the convention forbade, so the
 * convention became a sort (SERVER-077). Duplicates are collapsed, so a
 * (corrupt) thread naming itself as its own parent waits on itself exactly zero
 * times.
 */
export function runInLanes<T>(
  mutex: DocumentMutex,
  keys: readonly (string | null | undefined)[],
  task: () => Promise<T>,
): Promise<T> {
  const lanes = [
    ...new Set(keys.filter((key): key is string => key !== null && key !== undefined)),
  ].sort();
  const enter = (index: number): Promise<T> => {
    const key = lanes[index];
    return key === undefined ? task() : mutex.run(key, () => enter(index + 1));
  };
  return enter(0);
}

/**
 * Put a plan's file operations on disk, all-or-nothing, having first checked
 * that none of them escapes the workspace.
 *
 * Split out of {@link runMutation} for the bulk act (SPEC.md §4's "One action,
 * one commit", SERVER-077), which applies **one group per document** so that a
 * document whose write fails is refused individually — "nothing about this
 * document reached the commit" — while the rest of the act still lands. The
 * group is the unit of atomicity either way, which is why the rollback lives
 * here and not in the caller.
 */
export function applyOperations(
  workspace: DocsWorkspace,
  docId: string,
  operations: readonly FileOperation[],
): void {
  // Containment is checked for every path of every verb in one place, before
  // any of them is acted on: a plan that would escape the workspace leaves it
  // byte-for-byte untouched.
  for (const operation of operations) {
    for (const path of operationPaths(operation)) {
      assertContained(workspace.workspaceRoot, path);
    }
  }

  // A group that touches more than one path is all-or-nothing. Anchored thread
  // creation writes the parent's frontmatter *and* the new thread file
  // (SPEC.md §6, SERVER-006); a failure between the two would leave an anchor
  // pointing at a conversation that does not exist — the one state §6 says must
  // never be observable. A single-operation group needs nothing: every write
  // here is a rename over the target, so it either landed whole or not at all.
  const undo: Undo[] = [];
  try {
    for (const operation of operations) {
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
          docId,
          error: String(rollbackError),
        });
      }
    }
    throw error;
  }
}

/** Everything a plan says about a write that has already landed on disk. */
export type MutationTail = Omit<MutationPlan, "operations">;

/**
 * The half of the pipeline that runs **after** the bytes are on disk: commit,
 * acknowledge, re-project, announce.
 *
 * Its own module note explains why that order is load-bearing. It is a separate
 * function so the bulk act can reach it with one merged tail after N per-document
 * write groups (SERVER-077) — the whole point of that act being that it produces
 * *one* commit, *one* re-projection pass and *one* invalidation frame however
 * many documents it changed.
 */
export async function finishMutation(
  workspace: DocsWorkspace,
  request: {
    /**
     * The document this commit is keyed on. For an act over a set it is the
     * representative — the first document the act changed — and it is never
     * load-bearing there: `docIds` carries the subject on the wire and in the
     * trailers, and the edit-session tracker seals by staged **path**.
     */
    readonly docId: string;
    /** Every document one act changed; see `CommitRequest.docIds`. */
    readonly docIds?: readonly string[] | undefined;
    readonly actor: Actor;
    readonly plan: MutationTail;
  },
): Promise<CommitOutcome | null> {
  const { plan } = request;
  const act = plan.commit?.act;

  // §4's "three acts commit alone": a deletion and a staged bulk Save "close the
  // open window, let that commit land, and then commit by themselves". The close
  // is *first* and it is what the flush buys — for a deletion, the create commit
  // of a document created and deleted inside one window stops being something
  // this deletion can amend away, which is what leaves the create recoverable
  // (`git cat-file`) and makes §7's "git preserves history" true.
  if (act === "commits-alone") await workspace.git.closeWindow("commits-alone");

  // An act that commits alone folds in neither direction. `docIds` already says
  // that for an act over a named set (SERVER-077); a deletion names no set, so
  // the same thing is said in the other way the committer understands.
  const squash = act === "commits-alone" ? false : plan.commit?.squash;
  const commit =
    plan.commit === null
      ? null
      : await workspace.git.commit({
          docId: request.docId,
          ...(request.docIds === undefined ? {} : { docIds: request.docIds }),
          actor: request.actor,
          subject: plan.commit.subject,
          paths: plan.stage,
          ...(plan.commit.anchors === undefined ? {} : { anchors: plan.commit.anchors }),
          ...(squash === undefined ? {} : { squash }),
          // Tells the committer this commit's subject *names* an act, so the
          // close below leaves it alone rather than relabelling it an editing
          // session. It does not itself close anything.
          ...(act === "names-the-window" ? { act: true } : {}),
        });

  // §4's edit acknowledgment (SERVER-052). Told about *every* mutation, not only
  // the editor's saves: a commit by the other party is what seals an open
  // session, which is how a user's reported range never spans an agent's commit
  // to the same document. Synchronous and I/O-free — the git reads an event
  // needs happen on the tracker's own timer, never here on the autosave path.
  workspace.editSessions?.observeCommit({
    docId: request.docId,
    actor: request.actor,
    paths: plan.stage,
    editPath: plan.editSession ?? null,
    outcome: commit,
  });

  // §4: "the act's own change is the last thing in the window's commit, and the
  // commit's subject names the act" — so the close comes **after** the commit,
  // and unconditionally. An act whose commit git skipped or refused (§14) still
  // happened, and a close that finds no window open is a no-op; making it
  // conditional on the commit landing would leave a window open across an act
  // for exactly the workspaces whose hooks already make history unreliable.
  //
  // Placed after `observeCommit` so the acknowledgment still sees commits in the
  // order they were made, and safe there because a window an act named is never
  // rewritten by its close — the sha the acknowledgment may have just published
  // cannot move under it.
  if (act === "names-the-window") await workspace.git.closeWindow("act");

  // After the commit and before the response — a hook failure must not cost the
  // projection its update, or the UI would stop showing a change that is on disk.
  // Taken after the write and before the projection moves: the tree is derived
  // from rows, so this is the last moment it still answers what a client
  // fetched before the mutation.
  const treeBefore = plan.mayChangeTree === true ? folderTreeSignature(workspace.projection) : null;

  // §7's roster, measured the same way and at the same moment, and **not** gated
  // behind a plan flag (SERVER-115). A lane row is computed at read time, so
  // writes named after other resources move it: a designated conversation's
  // title is a row's `origin.title`, an agent-def's path decides its resident's
  // `docId`, a deletion takes a lane away, and a rename of a document a held
  // event came from rewrites a lane's `summary`. No plan can honestly declare
  // which of its writes does that without re-deriving the roster — which is the
  // measurement — and every attempt at declaring it per verb is what this
  // issue's seven sibling defects were. It is affordable unflagged where
  // `mayChangeTree` is not because the cost is the number of *designated* lanes
  // (usually none), not the size of the corpus. See {@link rosterSignature}.
  const rosterBefore = rosterSignature(workspace.projection);

  for (const path of plan.unproject) {
    removeDocument(workspace.projection, abs(workspace, path));
  }
  for (const path of plan.project) {
    if (classifyPath(path) === null) continue;
    projectDocument(workspace.projection, abs(workspace, path));
  }

  const measured: QueryKey[] = [...plan.keys];
  if (treeBefore !== null && folderTreeSignature(workspace.projection) !== treeBefore) {
    measured.push(TREE_KEY);
  }
  if (rosterSignature(workspace.projection) !== rosterBefore) measured.push(AGENTS_KEY);
  workspace.bus.invalidate(dedupeKeys(measured));

  return commit;
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

  applyOperations(workspace, request.docId, plan.operations);

  const commit = await finishMutation(workspace, {
    docId: request.docId,
    actor: request.actor,
    plan,
  });

  return { changed: true, warnings: [...validationWarnings, ...commitWarnings(commit)], commit };
}
