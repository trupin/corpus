// One document's change across a commit range (SPEC.md §4's edit-acknowledgment
// rider, signed 2026-08-02; CONTRACT-028's `GET /api/docs/{id}/diff`).
//
// Two readers live here and they answer different questions with the same git
// plumbing:
//
//   - {@link readRangeStats} — the three numbers a `doc.edited` queue event
//     carries. Frugal by construction: `--shortstat` and `rev-list --count`
//     never materialise the diff, which is the whole reason the event can name a
//     range without paying for its body.
//   - {@link readDocDiff} — the route's answer, which *does* read the body and
//     bounds it.
//
// Every git invocation here is read-only plumbing against object names
// (`rev-parse`, `rev-list`, `log`, `diff <tree-ish> <tree-ish>`). None of them
// touches `.git/index`, and the two exported readers above take no lock of their
// own — which is what lets `sessions.ts` call them from a timer without queueing
// an emission behind an autosave.
//
// The **route** is the exception, and it is §4's read-back rule rather than an
// inconsistency: "Any operation that names, reads or reverts a commit closes the
// open window before it runs." `readDocDiff` therefore runs inside
// `AutoCommitter.withClosedWindow`, which closes the window and holds the git
// lock across the whole read. The acknowledgment path needs none of that because
// it already closed its window a different way — `end()` calls
// `endSquashSession` before the first git read — and closing again there would
// amend a commit the event has already published, which is the one thing that
// must not happen (SERVER-052 review, PR #22).

import {
  DOC_DIFF_MAX_CHARS,
  EMPTY_TREE_OBJECT_ID,
  type DocChangeStats,
  type DocDiff,
  type DocDiffQuery,
} from "@corpus/contract";
import { findDocumentRow } from "../docs/index.js";
import { badRequest, notFound } from "../errors.js";
import { listFileRevisions, resolveRevision, type AutoCommitter, type Git } from "../git/index.js";
import type { ProjectionDb } from "../projection/index.js";

/** What a range with nothing in it reports — and what a never-committed document answers. */
export const NO_CHANGE_STATS: DocChangeStats = { commits: 0, insertions: 0, deletions: 0 };

/**
 * `--no-ext-diff` and `--no-textconv` are a boundary, not a preference: both
 * `diff.external` and a `textconv` filter name a **command** the workspace's own
 * `.git/config` supplies, and a `git diff` that honoured them would run it
 * inside a request handler. The route's contract is a unified diff of the
 * committed bytes; nothing about it needs a workspace-configured driver.
 */
const DIFF_FLAGS = ["--no-ext-diff", "--no-textconv"] as const;

/** `git diff`'s left-hand side may be a tree; `to` must always be a commit. */
const isEmptyTree = (ref: string): boolean => ref === EMPTY_TREE_OBJECT_ID;

/**
 * The full sha `ref` names, or `null`. The empty tree is passed through
 * unresolved — it is a tree rather than a commit, so `rev-parse ^{commit}`
 * rejects it, yet it is exactly what a `doc.edited` event carries as `from` for a
 * document introduced by the repository's root commit, and the range that event
 * publishes has to be passable straight back here.
 */
async function resolveRangeEnd(git: Git, ref: string): Promise<string | null> {
  if (isEmptyTree(ref)) return ref;
  return resolveRevision(git, ref);
}

/** The parent of `sha`, or `null` when it is a root commit (or unreadable). */
export async function parentOf(git: Git, sha: string): Promise<string | null> {
  const result = await git.exec(["rev-parse", "--verify", "--quiet", `${sha}^`]);
  const parent = result.stdout.trim();
  return result.ok && parent !== "" ? parent : null;
}

/** The newest commit that touched this file, or `null` for a path with no history. */
export async function newestCommitFor(git: Git, path: string): Promise<string | null> {
  return (await listFileRevisions(git, path, 1))[0] ?? null;
}

/**
 * The newest commit **before `sha` that touched `path`**, or `null` when this
 * document has no earlier revision.
 *
 * This is what a range's `from` has to be, and it is not `sha`'s parent
 * (SERVER-097). §4's commit window belongs to a **party**, not to a document, so
 * the commit sitting immediately before a session's first one is whatever the
 * *other* party last did — to whichever document. Reproduced in the user's own
 * workspace as a `doc.edited` whose `from` was an agent commit to a different
 * document entirely, and party-scoped windows (SHARED-040) make that the routine
 * case rather than the unlucky one.
 *
 * What it costs is nothing that was ever right: every commit skipped over left
 * this file byte-identical, so `git diff from..to -- path` and
 * `rev-list --count from..to -- path` — both already path-scoped — report the
 * same numbers either way. What changes is only the **claim**: §4 calls `from`
 * the state the document was in before the session, and now it is one.
 *
 * The walk starts at `sha`'s parent rather than at `sha` with `--skip=1`, so it
 * stays correct for a `sha` that does not itself touch `path` — and a root
 * commit, having no parent, is the same `null` as a document with no history.
 * Both reach the caller as `EMPTY_TREE_OBJECT_ID`, which is what the range
 * already published for a document introduced by the repository's root commit
 * and what `GET /api/docs/{id}/diff` already accepts back.
 */
export async function previousCommitFor(
  git: Git,
  sha: string,
  path: string,
): Promise<string | null> {
  const parent = await parentOf(git, sha);
  if (parent === null) return null;
  const result = await git.exec(["rev-list", "--max-count=1", parent, "--", path]);
  const found = result.stdout.trim();
  return result.ok && found !== "" ? found : null;
}

/**
 * `git diff --shortstat`'s one line, e.g. ` 1 file changed, 5 insertions(+), 2
 * deletions(-)`. Either count is absent when it is zero, and the whole line is
 * absent when nothing changed — so the parse reads what is there rather than
 * expecting a fixed shape. The leading file count is deliberately dropped:
 * `DocChangeStats` publishes no `files` because, path-scoped, it is always 1.
 */
export function parseShortstat(output: string): { insertions: number; deletions: number } {
  const read = (unit: string): number => {
    const match = new RegExp(`(\\d+) ${unit}`).exec(output);
    return match === null ? 0 : Number(match[1]);
  };
  return { insertions: read("insertions?\\(\\+\\)"), deletions: read("deletions?\\(-\\)") };
}

/**
 * The three numbers `DocChangeStats` publishes, for `from`..`to` scoped to one
 * file. `from` is exclusive and `to` inclusive, exactly as `git diff from..to`
 * reads it.
 *
 * `commits` is counted with `rev-list` rather than tallied by the caller, because
 * the question the contract asks — "commits in the range that touched this
 * document" — is about the range, not about the writes one producer happened to
 * observe: a user session interleaved with the user's *own* non-editor writes to
 * the same file (a thread landing an anchor in its frontmatter, an archive) has
 * those commits in its range, and a counter kept on the side would not know.
 */
export async function readRangeStats(
  git: Git,
  from: string,
  to: string,
  path: string,
): Promise<DocChangeStats> {
  const shortstat = await git.exec(["diff", ...DIFF_FLAGS, "--shortstat", from, to, "--", path]);
  const counted = await git.exec(
    isEmptyTree(from)
      ? ["rev-list", "--count", to, "--", path]
      : ["rev-list", "--count", `${from}..${to}`, "--", path],
  );
  const commits = counted.ok ? Number(counted.stdout.trim()) : 0;
  return {
    commits: Number.isFinite(commits) ? commits : 0,
    ...parseShortstat(shortstat.ok ? shortstat.stdout : ""),
  };
}

/** The unified diff of one file across the range; empty when git could not answer. */
export async function readRangeDiff(
  git: Git,
  from: string,
  to: string,
  path: string,
): Promise<string> {
  const result = await git.exec(["diff", ...DIFF_FLAGS, from, to, "--", path]);
  return result.ok ? result.stdout : "";
}

export interface BoundedDiff {
  readonly diff: string;
  readonly truncated: boolean;
  readonly totalChars: number;
}

/**
 * Cut a unified diff down to `max` characters at a **line** boundary — which is
 * SPEC.md §9.2's rule read literally: *"Truncation drops whole hunks while it can
 * and then cuts the straddling hunk at a line boundary, so the bound is spent on
 * content rather than on alignment."*
 *
 * Those are one operation, not two. Every hunk boundary is also a line boundary,
 * so "the last line boundary at or before `max`" keeps every hunk that fits whole
 * and then keeps as much of the straddling one as the budget allows. There is no
 * hunk scan here any more, and none is needed: a document line that merely looks
 * like a header (`+@@ careful @@`) is content either way, because the cut never
 * asks what a line *is*.
 *
 * **What this replaced, and why it had to be a contract change first**
 * (CONTRACT-032, from SERVER-058). The previous rule dropped whole hunks and cut
 * inside one only when that single hunk was larger than the **whole** bound. A
 * hunk smaller than the bound but larger than the budget left where it sits was
 * dropped whole, and the answer was then whatever preceded it. That is the
 * ordinary edit shape rather than a corner: a save re-stamps `updated:`, so git
 * emits a tiny frontmatter hunk and then one body hunk carrying the change.
 * Measured on the real route at **401 characters of an allowed 16 000**, and at
 * **231 of 16 000** for a diff totalling 21 001. `DocDiffSchema.truncated`
 * published the narrow rule, so widening it here would have contradicted the
 * contract — which is why SERVER-058 waived the case on the record instead of
 * fixing it, and why the fix begins in `packages/contract`.
 *
 * **What it costs, stated rather than glossed.** The last hunk of a truncated
 * diff may be a prefix of itself, so its header's line counts describe more lines
 * than follow it. `truncated: true` is what says so, `totalChars` says by how
 * much, and nothing in this repository applies a diff — the CLI prints it and the
 * agent reads it. What is never given up is readability: the cut is never
 * mid-line and therefore never mid hunk-header.
 *
 * **With no line boundary at or before the bound at all, the answer is empty**
 * (SERVER-149). The boundary rule permits nothing, so nothing is what comes back
 * — `truncated: true` and `totalChars` still say, quantitatively, that a whole
 * diff is being withheld, so no caller can read the empty string as "nothing
 * changed". This function used to cut at `max` here instead, which is a mid-line
 * cut, and §9.2's rider forbids one without exception: *"The cut is never
 * mid-line, and never mid hunk-header: a truncated diff is always something a
 * reader can read."* A mid-line prefix of a diff is not readable as a diff, which
 * is the reason the rider gives for its own rule.
 *
 * The case is unreachable through `GET /api/docs/{id}/diff`, and only by
 * accident: the first newline of a real `git diff` falls at index 90, inside the
 * `diff --git a/… b/…` header, so a bound of {@link DOC_DIFF_MAX_CHARS} always
 * has a boundary behind it. That is a property of git's output format rather than
 * anything this codebase guarantees, so the rule is obeyed here rather than
 * assumed away. Nothing reachable is lost by obeying it, and the sentence is
 * signed.
 */
export function truncateDiff(text: string, max: number = DOC_DIFF_MAX_CHARS): BoundedDiff {
  const totalChars = text.length;
  if (totalChars <= max) return { diff: text, truncated: false, totalChars };

  // `lastIndexOf` clamps a negative `fromIndex` to 0 rather than searching
  // nothing, so a leading newline would answer a bound of zero with one
  // character. A non-positive bound admits no boundary, and says so here.
  const newline = max > 0 ? text.lastIndexOf("\n", max - 1) : -1;
  const diff = newline === -1 ? "" : text.slice(0, newline + 1);
  return { diff, truncated: true, totalChars };
}

export interface DocDiffDeps {
  readonly git: Git;
  readonly projection: ProjectionDb;
  /**
   * The committer, for {@link AutoCommitter.withClosedWindow} alone — this route
   * writes nothing. It is here because §4's read-back rule makes closing the
   * open commit window part of *answering a read*: see {@link readDocDiff}.
   */
  readonly committer: AutoCommitter;
}

/**
 * A revision this repository does not contain is a `400` naming the parameter,
 * never a `404`: on this route the `404` means the *document* is unknown, and
 * conflating the two would have a caller believe its document had been deleted
 * when it had merely mistyped a range (CONTRACT-028 §6).
 */
const unknownRevision = (parameter: "from" | "to", ref: string): never => {
  throw badRequest("request failed validation", [
    {
      path: `query.${parameter}`,
      message: `${ref} is not a commit in this workspace`,
    },
  ]);
};

/**
 * `GET /api/docs/{id}/diff` (SPEC.md §4, CONTRACT-028).
 *
 * The range is resolved before anything is read, and both defaults are computed
 * from the document's own history: `to` is the newest commit that touched its
 * file and `from` is the newest commit **before it that touched the same file**,
 * so the bare `corpus doc diff <id>` §4 spells reads as "what changed in this
 * document's last commit".
 *
 * `from` is {@link previousCommitFor} rather than {@link parentOf} for the reason
 * that function documents (SERVER-097, and SERVER-113 for this route): under §4's
 * party-scoped commit window the commit immediately preceding a document's newest
 * one is routinely the *other* party's work on a *different* document, so the
 * parent is a false claim about this document's provenance — measured live as a
 * default base whose only file was a neighbour's. The numbers do not move, since
 * every commit skipped over left this file byte-identical and both readers below
 * are path-scoped; what moves is the claim. It is also what the `doc.edited`
 * acknowledgment already publishes, so the event an agent receives and the route
 * it calls to see that change now name the same base instead of disagreeing.
 * A document whose first commit is its only one therefore diffs against
 * `EMPTY_TREE_OBJECT_ID` — "nothing before this touched it", which the contract
 * already accepts back as a `from` and which yields the same whole-file-added
 * diff a base predating the file did.
 *
 * An explicitly named `from` is untouched by any of this: a caller that quotes a
 * range gets exactly that range, including one starting at a commit that never
 * touched this document.
 *
 * The diff is taken at the path the document holds **now**. A document moved
 * across the range therefore shows what git shows for its current path, which is
 * the same answer `git log -- <path>` gives and the only one that needs no
 * rename-detection heuristic in a route whose job is to report, not to infer.
 *
 * **Everything except the document lookup is path-scoped**, and under §4's
 * party-scoped commit window that is load-bearing rather than tidy. One window
 * commit now holds every document its party touched while it was open, so "the
 * diff of this commit" and "the diff of this document" are no longer the same
 * bytes: `readRangeStats` and `readRangeDiff` both end in `-- <path>`, and
 * `newestCommitFor` asks `git log -- <path>`, so a range spanning a neighbour's
 * save reports nothing for a document that neighbour did not touch. Before the
 * window was party-scoped a commit-wide answer would have been right by
 * accident; it would be wrong now.
 */
export async function readDocDiff(
  deps: DocDiffDeps,
  id: string,
  query: DocDiffQuery,
): Promise<DocDiff> {
  // Outside the critical section on purpose: an unknown id is answered from the
  // projection, and a `404` must not close anyone's commit window.
  const row = findDocumentRow(deps.projection, id);
  if (row === null) throw notFound(`no document with id ${id}`);
  const { git } = deps;
  const path = row.path;

  // ─────────────────────────────────────────────────────────────────────────
  // Yes: a `GET` closes the commit window, and that can rewrite a commit. It is
  // deliberate, and it is SPEC.md §4 — "Nothing reads a history the window is
  // still holding. Any operation that names, reads or reverts a commit closes
  // the open window before it runs."
  //
  // The reason is that an open window is not a finished commit: it is a commit
  // the server intends to keep amending, so its boundary and its sha are both
  // provisional. A diff read against it answers about a change that is still
  // growing — `corpus doc diff` would show a truncated version of the edit it
  // was asked about, and would name a sha that has moved by the time the caller
  // quotes it back.
  //
  // What the close costs is bounded and is *not* a new commit: the window's
  // content has been in git since its first save, so closing only stops later
  // saves folding in and relabels the subject where no act named it (one amend,
  // same tree). A diff therefore adds a commit *boundary* to the history — the
  // person's next keystroke starts a fresh window — and never a commit.
  //
  // The close and the read are one critical section for the same reason the
  // rule exists at all: released in between, an autosave lands and opens a new
  // window under the read.
  // ─────────────────────────────────────────────────────────────────────────
  return deps.committer.withClosedWindow("read-back", async () => {
    // `to` names the *head* of the range, which the contract defines as a commit
    // — so the empty tree is not admissible here even though it is for `from`.
    const to =
      query.to === undefined
        ? await newestCommitFor(git, path)
        : ((await resolveRevision(git, query.to)) ?? unknownRevision("to", query.to));

    // A document the workspace has never committed — a file not yet committed,
    // or a workspace with no git at all (SPEC.md §11). An answer, not an error.
    if (to === null) {
      return {
        id,
        path,
        from: null,
        to: null,
        stats: NO_CHANGE_STATS,
        diff: "",
        truncated: false,
        totalChars: 0,
      };
    }

    const from =
      query.from === undefined
        ? ((await previousCommitFor(git, to, path)) ?? EMPTY_TREE_OBJECT_ID)
        : ((await resolveRangeEnd(git, query.from)) ?? unknownRevision("from", query.from));

    const stats = await readRangeStats(git, from, to, path);
    const bounded = truncateDiff(await readRangeDiff(git, from, to, path));
    return { id, path, from, to, stats, ...bounded };
  });
}
