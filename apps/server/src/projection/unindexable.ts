// The recovery surface for documents nobody can see (SPEC.md §5, §14 —
// SERVER-038).
//
// SERVER-037 stopped the *creation* of documents under a path segment the
// document walk skips (`data/docs/.claude/…`, `data/docs/node_modules/…`) and
// cleaned up nothing already committed. Those files are structurally invisible
// to `doctor`: `enumerateDocuments` skips exactly the segments `classifyPath`
// does, so a `missing_row` can never be produced for one, and the only way to
// find them is `git log` plus a raw filesystem walk. This pass is that walk,
// with the commit that introduced each file attached — a finding that names a
// path and nothing else leaves a person exactly where `git log` already had
// them.
//
// **Report-only, and a `warning` rather than `drift`.** Nothing here is moved,
// deleted, rewritten or committed; deletion stays a user act (§7). The findings
// never move `ok` and never change `corpus db doctor`'s exit code, because §14's
// standing `rebuild && doctor` clean invariant is about the projection
// disagreeing with the files — and the projection is *correct* here. The files
// are real, and no rebuild can ever index them; a verdict flip would fail a
// routine check on precisely the workspaces that most need to run it.
//
// **Rooted at `data/docs`, deliberately.** Not the workspace root, and not the
// other four roots: `.claude/skills` indexes only `SKILL.md`, so a walk there
// would report every skill's `README.md`, and `data/threads` is flat, so it
// would report every nested file. Both are legitimate shapes, so both are
// different findings about a different bug (sprint-018, Out of Scope).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { extname, join, resolve } from "node:path";
import { sanitizeGitEnv } from "../git/env.js";
import { readDocumentIdentity } from "./project-document.js";
import { DOCS_ROOT, classifyPath, workspaceRelativePath } from "./roots.js";

/**
 * The kinds this pass produces. `unindexable_file` is the contract's published
 * core kind (`DOCTOR_WARNING_KINDS` in `packages/contract`); the truncation
 * notice is a server-only kind, which the wire deliberately allows — a warning
 * carries no verdict, so a consumer that does not recognise the kind still
 * renders its `detail` and loses nothing.
 */
export const DOCTOR_WARNING_KINDS = ["unindexable_file", "unindexable_files_truncated"] as const;

export type DoctorWarningKind = (typeof DOCTOR_WARNING_KINDS)[number];

/** A report-only finding: true, actionable, and not a disagreement with the projection. */
export type DoctorWarning = {
  readonly kind: DoctorWarningKind;
  /** Workspace-relative path, absent on a finding that concerns no single file. */
  readonly path?: string | undefined;
  readonly detail: string;
  /** Short sha of the commit that introduced the file, absent when there is none. */
  readonly commit?: string | undefined;
};

/**
 * How many findings one report lists. Each costs a `git log` child process, so
 * an unbounded report would turn a workspace with a whole tree in the wrong
 * place — the exact accident this pass exists for — into a `doctor` run that
 * spawns thousands of processes inside one request. Past the limit the report
 * says so rather than pretending the list is complete.
 */
export const UNINDEXABLE_WARNING_LIMIT = 50;

/** How long one `git log` may take before the finding is reported without its commit. */
export const GIT_TIMEOUT_MS = 5000;

/** git's own output here is one line; the budget only has to cover a pathological subject. */
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;

export type CreatingCommit = {
  /** Short sha — `%h`, which satisfies the wire's `[0-9a-f]{7,64}`. */
  readonly sha: string;
  readonly subject: string;
};

export type ReadCreatingCommit = (
  workspaceRoot: string,
  relativePath: string,
) => CreatingCommit | null;

/**
 * The commit that added `relativePath`, or `null` when there is none — the file
 * is uncommitted, the repository has no commits, or the workspace has no git at
 * all. All three are ordinary states, so all three are answered rather than
 * raised.
 *
 * `execFileSync` because `doctor` is synchronous end to end (its route handler
 * hands the report straight to `c.json`), and affordable because it runs once
 * per finding: a healthy workspace spawns nothing at all. `--diff-filter=A -n1`
 * is the newest commit that *added* the path, which is what "where did this come
 * from" means for a file that was deleted and later restored.
 */
export const readCreatingCommit: ReadCreatingCommit = (workspaceRoot, relativePath) => {
  let stdout: string;
  try {
    stdout = execFileSync(
      "git",
      ["log", "--diff-filter=A", "-n1", "--format=%h %s", "--", relativePath],
      {
        cwd: workspaceRoot,
        // Sprint-005 Open Conflict 6: every git child in `apps/server` runs
        // sanitized, reads included — otherwise a server started from inside a
        // git hook inherits that hook's `GIT_DIR` and answers about a foreign
        // repository.
        env: sanitizeGitEnv(),
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        timeout: GIT_TIMEOUT_MS,
        // git narrates "not a repository" on stderr; the exit code already says
        // it, and inheriting the stream would pollute the server log.
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return null;
  }
  // `%h` cannot contain a space and `%s` is a single line, so the first space is
  // the field boundary — no separator this parse has to trust the subject about.
  const line = stdout.trim();
  const gap = line.indexOf(" ");
  if (line === "") return null;
  return gap < 0
    ? { sha: line, subject: "" }
    : { sha: line.slice(0, gap), subject: line.slice(gap + 1) };
};

export interface UnindexableOptions {
  /** Overridden only by tests, which must not spend a git process per fixture file. */
  readonly readCreatingCommit?: ReadCreatingCommit | undefined;
  /** Overridden only by tests, so the truncation path costs three files rather than fifty-one. */
  readonly limit?: number | undefined;
}

type Finding = {
  readonly path: string;
  readonly absPath: string;
};

type WalkState = {
  readonly workspaceRoot: string;
  readonly limit: number;
  readonly findings: Finding[];
};

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * Would a file with this name be a document if it sat at the top of
 * `data/docs`? Asked of {@link classifyPath} rather than answered here, so this
 * pass carries no copy of the shape rule ("any `*.md`, at any depth") any more
 * than it carries a copy of the skip rule — two rules that must agree,
 * maintained separately, is how this bug arrived in the first place (sprint-018
 * Adjudication 9). The stem is neutral because the real one may itself be
 * dot-leading, which is one of the cases this pass exists to report.
 */
const wouldBeDocument = (filename: string): boolean =>
  classifyPath(`${DOCS_ROOT.path}/probe${extname(filename)}`) !== null;

/**
 * A markdown file the corpus can never show is a *finding* only when it is a
 * document — one carrying Corpus frontmatter with a valid `id`. Everything else
 * under a skipped segment is somebody's own file: a `README.md` inside a
 * vendored `node_modules` tree, a `.drafts/` folder someone is deliberately
 * hiding. The id is read through {@link readDocumentIdentity}, the same reader
 * the projector uses, so "is this a document" has one answer in this system.
 */
function isDocument(file: Finding): boolean {
  let content: string;
  try {
    content = readFileSync(file.absPath, "utf8");
  } catch {
    // Vanished or unreadable between the walk and the read: not a finding, and
    // not an error either — `doctor` mutates nothing and blames nobody.
    return false;
  }
  return readDocumentIdentity(DOCS_ROOT, file.path, content).kind === "id";
}

/**
 * Symlinked directories are not descended into (`entry.isDirectory()` is false
 * for a link), the conservative half of a deliberate asymmetry with
 * `enumerateDocuments`: that walk resolves links because plugin skills are
 * symlinked into `.claude/skills` (§10), while a finding here is about a file
 * *committed* under `data/docs` — and git tracks the link, not what it points
 * at.
 */
function walkUnindexed(state: WalkState, dir: string): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A `data/docs` that does not exist is simply empty, and a directory that
    // vanished mid-walk is a removal — neither is a finding.
    return;
  }

  for (const entry of [...entries].sort(byName)) {
    // One past the limit is enough to know the report is truncated; walking
    // further only spends time on a list nobody will be shown.
    if (state.findings.length > state.limit) return;

    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkUnindexed(state, abs);
      continue;
    }
    if (!entry.isFile() || !wouldBeDocument(entry.name)) continue;

    const path = workspaceRelativePath(state.workspaceRoot, abs);
    // The whole predicate: a file `data/docs` would index, which `classifyPath`
    // refuses. Under `markdown-tree` the only reason left is the skip rule, so
    // this follows a change to that rule without an edit here.
    if (path === null || classifyPath(path) !== null) continue;

    const finding = { path, absPath: abs };
    if (isDocument(finding)) state.findings.push(finding);
  }
}

const detailFor = (path: string, commit: CreatingCommit | null): string => {
  const origin =
    commit === null
      ? "It has no creating commit — it is uncommitted, or this workspace has no git repository."
      : `Added in ${commit.sha} "${commit.subject}".`;
  return (
    `${path} is a document the projection will never index: its path crosses a segment the ` +
    `document walk skips, so the corpus can never show it. ${origin} ` +
    "Move it elsewhere under data/docs/ or delete it — doctor changes nothing."
  );
};

const truncationDetail = (limit: number): string =>
  `more than ${String(limit)} files under data/docs/ can never be indexed; the first ` +
  `${String(limit)} are listed. Deal with those and run \`corpus db doctor\` again for the rest.`;

/**
 * Every document file under `data/docs` that `classifyPath` refuses, as
 * report-only warnings sorted by path. Empty on a healthy workspace — and empty
 * means no `git log` ran at all, which is what keeps `doctor` cheap enough to
 * stay inside a pre-commit hook's budget.
 */
export function collectUnindexableFiles(
  workspaceRoot: string,
  options: UnindexableOptions = {},
): DoctorWarning[] {
  const limit = options.limit ?? UNINDEXABLE_WARNING_LIMIT;
  const readCommit = options.readCreatingCommit ?? readCreatingCommit;
  const absoluteRoot = resolve(workspaceRoot);
  const state: WalkState = { workspaceRoot: absoluteRoot, limit, findings: [] };

  walkUnindexed(state, join(absoluteRoot, ...DOCS_ROOT.path.split("/")));

  const found = [...state.findings].sort(byPath);
  const warnings: DoctorWarning[] = found.slice(0, limit).map((file) => {
    const commit = readCommit(absoluteRoot, file.path);
    return {
      kind: "unindexable_file",
      path: file.path,
      detail: detailFor(file.path, commit),
      commit: commit?.sha,
    };
  });

  if (found.length > limit) {
    warnings.push({ kind: "unindexable_files_truncated", detail: truncationDetail(limit) });
  }
  return warnings;
}
