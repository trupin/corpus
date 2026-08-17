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
 * Cut a unified diff down to `max` characters at a **hunk** boundary, so what
 * comes back is still a diff rather than a fragment ending mid-line.
 *
 * A line beginning `@@` at column zero is a hunk header and nothing else: every
 * content line in a unified diff is prefixed by a space, `+` or `-`, so a
 * document line that itself starts with `@@` arrives here as ` @@…` or `+@@…`.
 *
 * **A hunk-aligned cut must keep at least one whole hunk**, which is why the
 * *first* hunk's header is not a candidate boundary. It is a boundary
 * arithmetically — the preamble alone is a syntactically well-formed diff — but
 * it carries none of the change, and a caller allowed 16 000 characters that
 * receives 166 of file headers has been told nothing. Measured on a real server
 * before this rule existed: a 500-paragraph rewrite arrives from git as one
 * 64 000-character hunk, whose only boundary is that first header.
 *
 * **A hunk larger than the whole bound is cut *inside*, at a line boundary** —
 * the exception the contract itself publishes on `DocDiff.truncated`, applied
 * wherever that hunk sits rather than only when it is the first. This is the
 * SERVER-058 case, and it is the *ordinary* edit shape: a save re-stamps
 * `updated:`, so git emits a tiny frontmatter hunk and then one body hunk
 * carrying the whole change. Dropping that body hunk whole leaves the only
 * admissible hunk boundary at the frontmatter — measured on a real server as
 * **401 characters of an allowed 16 000**, a well-formed diff saying a timestamp
 * changed and nothing else, which is a worse answer than a long one. Cutting
 * inside it is not a loss of alignment either: no cut anywhere can show a hunk
 * bigger than the whole budget, so the alternative to a prefix of it is nothing
 * of it.
 *
 * **A hunk that would fit the bound, but not the budget left where it sits, is
 * still dropped whole — and that can cost nearly all of the budget.** The answer
 * is then the boundary itself: `cut` characters of `max`, of which `max - cut`
 * goes unspent. SERVER-058's own shape reaches the worst of it — a 231-character
 * frontmatter hunk followed by a body hunk of 15 770 returns **231 of 16 000**,
 * the reported symptom verbatim, for a body hunk one character *under* the bound
 * rather than over it (PR #22 review, measured on this function). Nor is it
 * confined to diffs that barely overrun: with a third hunk after it the same
 * input totals 21 001 and still answers 231.
 *
 * That is left standing, deliberately, because within the published contract
 * there is no better answer for that input. "Keep whole hunks, then a line-prefix
 * of the next" is *exactly* the degenerate `max(hunk, line)` rule described
 * below, and `DocDiffSchema.truncated` promises the narrower thing: "whole hunks
 * are dropped from the end. A single hunk larger than the whole bound is the one
 * exception." Widening the exception to a hunk larger than the *remaining* budget
 * would abolish hunk alignment and contradict that sentence — a contract change,
 * not a change here.
 *
 * What bounds the damage is that the waste and its likelihood are the same
 * number. The poor answer needs the straddling hunk's size to fall in
 * `(max - cut, max]` — a window exactly `cut` wide — so answering with 231
 * characters requires a body hunk within 231 characters of the cap, while a cut
 * at 8 231 is easy to land on and wastes less than half the budget. The largest
 * waste is the rarest, and every hunk that does come back is complete.
 *
 * With no admissible hunk boundary at all — one hunk bigger than the bound, a
 * second hunk starting past it, or a preamble larger than the whole cap — the
 * fallback is the same line boundary.
 *
 * Note that `max(hunk boundary, line boundary)` — the shape first proposed — is
 * *not* what this does, because it is degenerate: every hunk boundary is also a
 * line boundary, so the last line boundary ≤ cap is never smaller than the last
 * hunk boundary ≤ cap and the maximum is always the line one. That rule would
 * abolish hunk alignment entirely, cutting mid-hunk even where whole hunks fit,
 * and contradict the published contract text rather than apply its exception.
 */
export function truncateDiff(text: string, max: number = DOC_DIFF_MAX_CHARS): BoundedDiff {
  const totalChars = text.length;
  if (totalChars <= max) return { diff: text, truncated: false, totalChars };

  const hunks: number[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) hunks.push(offset);
    offset += line.length + 1;
  }
  // `hunks[0]` ends the preamble and begins the first hunk; a cut there would
  // return a diff with no hunks in it. Everything after it keeps at least one.
  const boundaries = hunks.slice(1);
  const index = boundaries.findLastIndex((start) => start <= max);
  const cut = boundaries[index];
  if (cut !== undefined && cut > 0) {
    // The hunk this cut would drop runs from the boundary to the next header, or
    // to the end of the diff when it is the last one.
    const dropped = (boundaries[index + 1] ?? totalChars) - cut;
    if (dropped <= max) return { diff: text.slice(0, cut), truncated: true, totalChars };
  }

  const newline = text.lastIndexOf("\n", max - 1);
  const diff = newline === -1 ? text.slice(0, max) : text.slice(0, newline + 1);
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
    // or a workspace with no git at all (SPEC.md §14). An answer, not an error.
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
