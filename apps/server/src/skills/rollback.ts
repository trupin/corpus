// `POST /api/skills/{name}/rollback` — §7's loop-safety escape hatch.
//
// Skills are ordinary documents, editable in the board's editor like any other.
// That is the point, and it is also the hazard: a bad edit to a core-loop skill
// (`orchestrate`, `comment`) can break the very loop that would otherwise fix it.
// §7's answer is a targeted git revert **performed by the server**, because the
// server is the sole writer — a CLI running `git checkout` on a skill file would
// bypass validation, the projection and the watcher at once.
//
// The whole verb is: pick a revision, read the file's content at it, and save
// those bytes through the ordinary mutation pipeline. Nothing about the write is
// special, and that is the design: `MutationPlan` → `runMutation` means the
// restoration validates, writes atomically, auto-commits with the acting party as
// author, re-projects synchronously and invalidates — in the same order, with the
// same self-write registration, as every other mutation. A hand-rolled
// `writeFileSync` + `git commit` would be a second write path with its own bugs.
//
// Two structural notes on git:
//
// - **The reads close §4's commit window and take the git lock; the commit takes
//   it again.** A rollback is the operation §4's read-back rule was written for
//   — it both *names* a revision and *reverts* to it — so the reads run inside
//   `AutoCommitter.withClosedWindow`, which closes the open window and holds the
//   git lock across the whole search. Closing first is what makes the candidate
//   list honest: an open window is a commit the server intends to keep amending,
//   so a sha chosen off it moves under the operator, and the sha this verb
//   prints in its own commit subject would name an object no branch holds. It is
//   also why the close must be inside the same critical section as the search
//   rather than a call before it — released in between, an autosave opens a
//   fresh window under the read. `.git/index` being one shared file is the
//   second reason for the lock: ref resolution and blob reads must not race a
//   concurrent auto-commit. The commit that follows takes the lock for itself,
//   from inside `runMutation` — nesting the two would deadlock, because the lock
//   is a promise chain and the outer holder would be waiting on a link queued
//   behind its own completion. Correctness does not depend on holding one lock
//   across both: the revision is resolved to an immutable sha before anything is
//   read from it, and by then no window is open to move it.
// - **The rollback never folds into a previous auto-commit** (`squash: false`).
//   It is the answer to the edit that made it necessary, not a continuation of
//   it, and folding would amend that edit's commit away — deleting the history
//   the restoration is reading from.
//
// And one on ordering, which two serialization mechanisms make easy to get
// wrong. **The document lane is outermost**, exactly as it is on every other
// write verb (`docs/update.ts`, `docs/delete.ts`): the lane is entered first,
// and only then is the git lock taken — released again before `runMutation`
// takes it for the commit. Nothing anywhere takes the git lock and then waits
// for a document lane, so the two can never close a cycle.
// Everything that decides *what* to restore — the file on disk, the candidate
// walk, the validation — happens inside the lane too, because a rollback chosen
// against bytes a concurrent save has since replaced would silently overwrite
// that save (SERVER-022 finding 7, PR #11 review finding 14).

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Actor, SkillRollbackResult, Warning } from "@corpus/contract";
import { badRequest, notFound } from "../errors.js";
import { DOCS_KEY, docKey } from "../events/index.js";
import {
  REVISION_SEARCH_LIMIT,
  listFileRevisions,
  readVersionAt,
  resolveRevision,
  type Git,
} from "../git/index.js";
import {
  checkSave,
  findDocumentRowByPath,
  reportWarnings,
  runMutation,
  serializeWarnings,
  validateBeforeWrite,
  type DocsWorkspace,
  type DocumentMutex,
} from "../docs/index.js";
import { classifyPath, syntheticDocumentId } from "../projection/index.js";
import { skillDocumentPath } from "./paths.js";

/**
 * The document workspace plus the raw git command builder. `DocsWorkspace.git` is
 * the auto-committer — the sole *writer*, and the owner of the index lock; this
 * is the same underlying repository addressed for **reads only** (`rev-parse`,
 * `log`, `show`), which the committer's interface deliberately does not expose.
 */
export interface SkillsWorkspace extends DocsWorkspace {
  readonly gitCommands: Git;
}

/**
 * A revision that would restore something, with the bytes it holds.
 *
 * "Last-known-good" is defined as the contract states it — *the newest committed
 * revision of the file that validates* — with one qualification the definition
 * implies but does not spell out: a revision holding exactly what is on disk
 * restores nothing, so the walk steps over it. That single rule is what makes the
 * common case right in both directions. When the bad edit was saved through the
 * API it is committed, so `HEAD`'s blob is the current file and the answer is the
 * revision before it. When it was made by an outside editor and never committed,
 * `HEAD`'s blob is already the good version and the answer is `HEAD`.
 */
type Candidate = { readonly sha: string; readonly content: string };

/**
 * The outcome of a search, which is not the same thing as its answer.
 *
 * A `null` candidate means "the search found nothing", and the refusal has to
 * say how much of history the search actually covered — `truncated` is how it
 * knows. Irrelevant when a candidate was found, and always `false` for an
 * explicit `--to`, which examines exactly the revision it was given.
 */
type Search = { readonly candidate: Candidate | null; readonly truncated: boolean };

/**
 * The walk behind a bare rollback, bounded by {@link REVISION_SEARCH_LIMIT}.
 *
 * The bound is deliberate — each candidate costs one `git show` inside a request
 * handler — so the walk is *scoped*, not exhaustive, and it reports which it
 * was. One extra sha is listed rather than walked, purely as the probe that
 * distinguishes "history ends here" from "history continues past the bound":
 * listing is one `git log`, so the probe is free, while walking the extra
 * revision would not be.
 */
async function findLastKnownGood(
  workspace: SkillsWorkspace,
  path: string,
  current: string,
): Promise<Search> {
  const revisions = await listFileRevisions(workspace.gitCommands, path, REVISION_SEARCH_LIMIT + 1);
  const truncated = revisions.length > REVISION_SEARCH_LIMIT;
  for (const sha of revisions.slice(0, REVISION_SEARCH_LIMIT)) {
    const content = await readVersionAt(workspace.gitCommands, sha, path);
    if (content === null) continue;
    if (content === current) continue;
    if (checkSave(workspace.projection, path, content).blocking.length > 0) continue;
    return { candidate: { sha, content }, truncated };
  }
  return { candidate: null, truncated };
}

/**
 * The document this rollback is about: the id of whatever occupies `path` right
 * now. It is the lane the write serializes under and the `docId` the response
 * and the invalidation carry — one id, decided before anything is read, because
 * a lane cannot be entered after the read it is supposed to protect.
 *
 * Never derived from the restored bytes. §5 makes ids immutable, so the id a
 * restoration writes under is the one the document already has; an old revision
 * that happens to declare a different one is describing a document this
 * workspace does not have.
 *
 * The projection's row is the authority: it is the id the board, every thread
 * and every `[[ref]]` already use. A skill so badly edited that it no longer
 * parses has **no row** — the projection skipped it — and that is precisely the
 * case §7's escape hatch exists for, so the fallback is the id the skills root
 * synthesizes from the path. That root synthesizes for every file under it, and
 * a rollback never moves the file, so it is also the id the restored document
 * will project under once it parses again.
 */
function documentIdFor(workspace: SkillsWorkspace, path: string): string {
  const row = findDocumentRowByPath(workspace.projection, path);
  if (row !== null) return row.id;
  const root = classifyPath(path);
  /* c8 ignore next */
  if (root === null) throw notFound(`${path} is not a document`);
  return syntheticDocumentId(root, path);
}

/**
 * Why a bare rollback found nothing — said no more strongly than the search
 * earns (PR #11 review finding 15).
 *
 * "Its history holds nothing that differs and validates" is a claim about the
 * whole history, and the walk covers only {@link REVISION_SEARCH_LIMIT}
 * revisions. When it stopped at the bound the claim is scoped to the window it
 * actually examined and the operator is pointed at the escape from that window,
 * which already exists: `to` restores any revision git resolves, however far
 * back. Scoping rather than walking to the root because the bound is deliberate
 * — each candidate costs a `git show` inside a request handler, and an
 * unbounded walk would make a rollback's cost a function of the repository's
 * age. An operator who needs revision 51 knows something the walk cannot: which
 * one it is.
 */
function noCandidateReason(path: string, truncated: boolean): string {
  const opening = `no earlier committed version of ${path} to restore — `;
  return truncated
    ? opening +
        `none of the ${String(REVISION_SEARCH_LIMIT)} most recent commits touching it holds ` +
        "content that differs from the file on disk and validates, and older commits were not " +
        "examined; name one explicitly with `to` to restore it"
    : opening + "its history holds nothing that differs from the file on disk and validates";
}

/**
 * §14's promise is that a `null` commit always explains itself: the restoration
 * stands on disk and the reason is in `warnings`. `runMutation` produces no
 * warning for the one outcome it considers unremarkable — "nothing to commit" —
 * because for an ordinary save that means the save changed nothing. A rollback
 * reaches it two ways that are both real and neither unremarkable: restoring
 * bytes the file already held, and restoring bytes that differ from the file but
 * match what git already records for the path (recovering an *uncommitted* bad
 * edit — §7's headline case). The file changed in the second; there is simply
 * nothing for a commit to record. The gap is closed here rather than in the
 * pipeline, because for a save that silence is correct.
 */
function explainMissingCommit(warnings: readonly Warning[]): Warning[] {
  if (warnings.some((warning) => warning.code.startsWith("commit_"))) return [...warnings];
  return [
    ...warnings,
    {
      code: "commit_skipped",
      detail:
        "the restored content is already what git records for this path, so there was nothing " +
        "to commit; the file on disk holds it either way",
    },
  ];
}

export async function rollbackSkill(
  workspace: SkillsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  name: string,
  to: string | null,
): Promise<SkillRollbackResult> {
  const path = skillDocumentPath(name);
  const absPath = resolve(workspace.workspaceRoot, path);
  // One uniform refusal for "no such skill" and "archived" alike: archiving a
  // skill moves its folder to `.claude/skills-archived/` precisely to disable it
  // (§7), so an archived skill is not installed and rolling it back is a 404.
  // Unarchive it first.
  const assertInstalled = (): void => {
    if (existsSync(absPath)) return;
    throw notFound(`no skill named \`${name}\` is installed (${path} does not exist)`);
  };
  // Asked once here so an unknown name is refused without queuing behind an
  // unrelated write, and once more inside the lane, where a deletion that landed
  // while this waited becomes the same 404 rather than an ENOENT.
  assertInstalled();

  // Decided before the lane, because it *is* the lane key — and it reads the
  // projection, never the file, so nothing a concurrent save could change is
  // consulted outside the lane.
  const docId = documentIdFor(workspace, path);

  const result = await mutex.run(docId, async () => {
    assertInstalled();

    // What the file holds right now, which is what "restores nothing" is
    // measured against. Read here rather than inferred from `HEAD`: the case §7
    // cares most about is an uncommitted edit by an outside editor. Inside the
    // lane, so the bytes the candidate is chosen against are the bytes the
    // restoration will overwrite.
    const current = readFileSync(absPath, "utf8");

    // §4's read-back rule, in the same critical section as the read it protects
    // (see the module note). `read-back` and not `commits-alone`: the window
    // ends because its content is about to be *named*, which is true whichever
    // party owned it and true even if the restoration below never commits.
    const search: Search = await workspace.git.withClosedWindow("read-back", async () => {
      if (to === null) return findLastKnownGood(workspace, path, current);
      const sha = await resolveRevision(workspace.gitCommands, to);
      if (sha === null) {
        throw badRequest(`git does not resolve the revision \`${to}\``, [
          { path: "to", message: `\`${to}\` is not a revision in this workspace` },
        ]);
      }
      const content = await readVersionAt(workspace.gitCommands, sha, path);
      if (content === null) {
        throw badRequest(`${path} does not exist at \`${to}\``, [
          { path: "to", message: `${path} is not present in revision ${sha}` },
        ]);
      }
      return { candidate: { sha, content }, truncated: false };
    });

    const candidate = search.candidate;
    if (candidate === null) {
      // TEST-24's honest outcome, and the only one the wire can express: there
      // is no `warnings` code for "nothing to restore", and inventing a 200 that
      // rewrote nothing would report a rollback that did not happen. The claim
      // is scoped to what was actually examined — see {@link noCandidateReason}.
      throw notFound(noCandidateReason(path, search.truncated));
    }

    // The restoration is a save like any other and validates like any other
    // (§14). It also cannot be skipped: `--to` accepts any revision git
    // resolves, and an old revision predating a format rule is exactly the kind
    // of bytes that must not be written back unchecked.
    const validation = validateBeforeWrite(workspace, path, candidate.content);

    return runMutation(workspace, {
      docId,
      actor,
      warnings: validation,
      plan: {
        operations: [{ kind: "write", path, content: candidate.content }],
        stage: [path],
        project: [path],
        unproject: [],
        commit: {
          subject: `skill rollback: ${name} (${docId}) to ${candidate.sha.slice(0, 7)} by ${actor}`,
          squash: false,
        },
        keys: [DOCS_KEY, docKey(docId)],
        // Skills live outside `data/docs/`, which is the only tree
        // `GET /api/tree` describes — no folder badge can move (SERVER-018).
      },
    });
  });

  const outcome = result.commit;
  const sha =
    outcome !== null && (outcome.kind === "committed" || outcome.kind === "amended")
      ? outcome.sha
      : null;
  // `null` is the only honest value when no commit landed: the regex would accept
  // the pre-existing `HEAD`, and putting a commit that is not this restoration
  // into the field the audit trail reads is what CONTRACT-016 exists to prevent.
  const warnings = sha === null ? explainMissingCommit(result.warnings) : serializeWarnings(result);

  // §14 asks a warning to surface three ways — response, server log, console.
  // This is the log half, and it names the document, which a `Warning` does not.
  reportWarnings(workspace, docId, { ...result, warnings });

  return { name, docId, commit: sha, path, warnings };
}
