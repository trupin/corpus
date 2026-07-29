import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { InternalError, UsageError } from "./errors.js";
import { sanitizeGitEnv } from "./git-env.js";

/**
 * The staged half of `corpus doc check --staged` (SPEC.md §14) — and the CLI's
 * only read-only git plumbing.
 *
 * **Why this file exists at the src root** (sprint-013 Adjudication 12, Open
 * Conflict 8). `apps/cli/src/commands/hygiene.test.ts` guards the `doc`,
 * `thread` and `db` topics absolutely: those modules import no `node:fs` and no
 * `node:child_process`, call no `exec*`/`spawn*`, and do not so much as name
 * git. That guard is right, and `--staged` is the one thing it cannot express:
 * the content a pre-commit hook must validate is in **git's index**, so it
 * exists neither on disk nor on the server, and no HTTP call can produce it.
 * The resolution is this module — outside the guarded prefixes, one file, one
 * capability — imported by exactly one guarded module (`commands/doc/check.ts`),
 * which the hygiene guard pins by name. Every other prohibition stands
 * untouched.
 *
 * **Read-only by construction, not by convention.** {@link runReadOnlyGit}
 * refuses any subcommand outside {@link READ_ONLY_SUBCOMMANDS} before it spawns
 * anything, so "this helper never changes git state" is enforced here rather
 * than re-argued at each call site. `git` is driven through `execFile`, never a
 * shell — workspace paths come from the operator — and the environment is
 * sanitized for the same reason `corpus init` sanitizes it: a `corpus` command
 * invoked from inside a git hook inherits that hook's `GIT_DIR` and would
 * otherwise read *its* index.
 */

export interface StagedDocument {
  /** Workspace-relative path the content would be saved at. */
  readonly path: string;
  /** The blob as it stands in the index, which is not what is on disk. */
  readonly content: string;
}

/**
 * Whole documents are read into memory, so the ceiling is generous — but it is
 * set. `execFile`'s default is 1 MB and it *rejects* past it, which would turn a
 * large staged document into an opaque failure of the pre-commit hook.
 */
export const STAGED_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** A hook that never returns is worse than one that fails; git gets a deadline. */
export const STAGED_TIMEOUT_MS = 30_000;

/**
 * The only git subcommands this module may run. `diff` and `show` are what
 * `--staged` needs; `status` and `rev-parse` are the read-only queries a caller
 * legitimately reaches for next. None of them writes an object, moves a ref or
 * touches the index.
 */
export const READ_ONLY_SUBCOMMANDS: readonly string[] = ["diff", "show", "status", "rev-parse"];

/** Runs one git invocation and returns its stdout. Injectable so failures are testable. */
export type GitReader = (args: readonly string[], cwd: string) => Promise<string>;

const execFileAsync = promisify(execFile);

export const runReadOnlyGit: GitReader = async (args, cwd) => {
  const subcommand = args[0];
  if (subcommand === undefined || !READ_ONLY_SUBCOMMANDS.includes(subcommand)) {
    throw new InternalError(
      `refusing to run \`git ${subcommand ?? ""}\`: this helper runs only ${READ_ONLY_SUBCOMMANDS.join(", ")}.`,
    );
  }

  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      env: sanitizeGitEnv(),
      maxBuffer: STAGED_MAX_BUFFER_BYTES,
      timeout: STAGED_TIMEOUT_MS,
    });
    return stdout;
  } catch (cause) {
    throw readFailure(args, cause);
  }
};

/** git's own stderr is the actionable part; a stack trace is not. */
function readFailure(args: readonly string[], cause: unknown): UsageError {
  const detail =
    typeof cause === "object" && cause !== null && "stderr" in cause
      ? String(cause.stderr).trim()
      : cause instanceof Error
        ? cause.message
        : String(cause);
  return new UsageError(
    `\`git ${args.join(" ")}\` failed: ${detail === "" ? "git reported no detail" : detail}`,
    {
      hint: "`--staged` reads the workspace's git index, so the workspace must be a git repository with `git` on PATH.",
      cause,
    },
  );
}

/**
 * The five document roots (SPEC.md §4, §7) as pure path arithmetic.
 *
 * This is a deliberate, documented transcription of `DOCUMENT_ROOTS` in
 * `apps/server/src/projection/roots.ts`, for the same reason
 * `packages/contract/src/schemas/check.ts` transcribes the validator's codes:
 * the dependency direction is `packages/contract` ← `apps/cli`, and the CLI may
 * not import the server. Getting it wrong is visible rather than silent — a path
 * wrongly admitted is submitted as a document and reports frontmatter findings
 * for a file that is not one, and a path wrongly rejected simply is not checked.
 * Only the *shape* of each root is copied; type, status and id prefix are the
 * projection's business and are not needed to answer "is this a document?".
 */
const DOCUMENT_PATH_RULES = [
  { prefix: "data/docs/", shape: "markdown-tree" },
  { prefix: "data/threads/", shape: "markdown-flat" },
  { prefix: ".claude/skills/", shape: "skill-tree" },
  { prefix: ".claude/skills-archived/", shape: "skill-tree" },
  { prefix: ".claude/agents/", shape: "markdown-flat" },
] as const;

const SKILL_FILENAME = "SKILL.md";

/** Never descended into, whatever root it appears under — the projection skips it too. */
const IGNORED_SEGMENTS: ReadonlySet<string> = new Set(["node_modules"]);

/**
 * Whether a workspace-relative path names a document the server would index.
 * Anything else — the workspace `README.md`, `.gitignore`, a `notes.md` beside a
 * `SKILL.md` — is not a document, and submitting it would manufacture findings
 * about a file Corpus does not own.
 */
export function isDocumentPath(relativePath: string): boolean {
  const normalized = relativePath.split("\\").join("/");

  for (const rule of DOCUMENT_PATH_RULES) {
    if (!normalized.startsWith(rule.prefix)) continue;

    const segments = normalized.slice(rule.prefix.length).split("/");
    const filename = segments.at(-1);
    if (filename === undefined || filename === "") return false;
    if (segments.some((segment) => segment.startsWith(".") || IGNORED_SEGMENTS.has(segment))) {
      return false;
    }

    switch (rule.shape) {
      case "markdown-tree":
        return filename.endsWith(".md");
      case "markdown-flat":
        return segments.length === 1 && filename.endsWith(".md");
      case "skill-tree":
        return filename === SKILL_FILENAME;
    }
  }
  return false;
}

/**
 * Staged document paths, in index order. `--diff-filter=ACMR` keeps additions,
 * copies, modifications and renames and drops deletions — a deleted file has no
 * content to validate — and `-z` turns off git's path quoting so a name with a
 * space or a quote survives verbatim.
 */
export async function stagedDocumentPaths(
  root: string,
  git: GitReader = runReadOnlyGit,
): Promise<readonly string[]> {
  const stdout = await git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], root);
  return stdout
    .split("\0")
    .filter((path) => path !== "")
    .filter(isDocumentPath);
}

/**
 * The bytes git holds for a path in the index. `:<path>` (no leading `./`) is
 * resolved from the top of the working tree, which is exactly what
 * `git diff --cached --name-only` prints, and the leading colon means the
 * argument can never be mistaken for an option.
 */
export async function readStagedContent(
  root: string,
  path: string,
  git: GitReader = runReadOnlyGit,
): Promise<string> {
  return git(["show", `:${path}`], root);
}

/**
 * Every staged document as a `(path, content)` pair, ready to post to
 * `POST /api/check`'s `{documents}` branch. Nothing in the working tree is read
 * and nothing in git is changed: `git status --porcelain` is byte-identical
 * before and after.
 */
export async function collectStagedDocuments(
  root: string,
  git: GitReader = runReadOnlyGit,
): Promise<readonly StagedDocument[]> {
  const paths = await stagedDocumentPaths(root, git);
  const documents: StagedDocument[] = [];
  // Sequentially rather than in parallel: a pre-commit hook competes with
  // whatever else the operator is running, and a fan-out of `git show` on a
  // large staged set buys nothing that matters at this size.
  for (const path of paths) {
    documents.push({ path, content: await readStagedContent(root, path, git) });
  }
  return documents;
}
