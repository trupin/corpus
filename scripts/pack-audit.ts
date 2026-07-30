/**
 * The tarball audit behind `npm run pack:check` (INFRA-008).
 *
 * A packaging bug is invisible until someone installs the tarball on a machine
 * that has no repository to fall back on, so the file list `npm pack` reports is
 * asserted in **both directions**. The negative half alone is worthless — an
 * empty tarball passes every exclusion — so every artifact the installed tool
 * needs at runtime is a positive requirement, each one named after the resolver
 * that will look for it.
 *
 * Pure: it takes the parsed `npm pack --dry-run --json` file list and returns
 * violations. `scripts/check-pack.ts` is the thin runner that produces the list.
 */

import picomatch from "picomatch";
import { CLI_BUNDLE_PATH, SERVER_BUNDLE_PATH } from "./package-manifest.js";

/** One entry of `npm pack --dry-run --json`'s `files` array. */
export interface PackedFile {
  /** Package-relative, POSIX separators, no `package/` prefix. */
  readonly path: string;
  /** Unix mode as reported by npm (420 = 0o644, 493 = 0o755). */
  readonly mode?: number;
}

export interface RequiredEntry {
  /** Why the installed tool needs it — quoted verbatim in the failure. */
  readonly reason: string;
  readonly pattern: string;
  /** Minimum number of matching entries. Hashed bundles need "at least one". */
  readonly min: number;
}

/**
 * Everything the installed tool resolves at runtime. `ui/assets/*` is asserted
 * as a **count**, not a name: Vite hashes the bundle, and a tarball carrying
 * `index.html` without its JS is precisely the failure that renders a blank
 * board with a green server log.
 */
export const REQUIRED_PACK_ENTRIES: readonly RequiredEntry[] = [
  { reason: "the generated manifest", pattern: "package.json", min: 1 },
  { reason: "the operator-facing README (SPEC.md §15)", pattern: "README.md", min: 1 },
  { reason: "the license the manifest declares", pattern: "LICENSE", min: 1 },
  { reason: "the `corpus` bin", pattern: CLI_BUNDLE_PATH, min: 1 },
  {
    reason: "the server entry, `serverEntryCandidates()`'s packaged candidate",
    pattern: SERVER_BUNDLE_PATH,
    min: 1,
  },
  { reason: "the board's entry document, `resolveUiDistDir`", pattern: "ui/index.html", min: 1 },
  { reason: "the board's hashed script bundle", pattern: "ui/assets/*.js", min: 1 },
  { reason: "the board's stylesheet", pattern: "ui/assets/*.css", min: 1 },
  {
    reason: "the orchestrate skill `corpus init` installs",
    pattern: "assets/workspace/claude/skills/orchestrate/SKILL.md",
    min: 1,
  },
  {
    reason: "the comment skill `corpus init` installs",
    pattern: "assets/workspace/claude/skills/comment/SKILL.md",
    min: 1,
  },
  {
    reason: "the workspace .gitignore (stored dotless, renamed on install)",
    pattern: "assets/workspace/gitignore",
    min: 1,
  },
  { reason: "the workspace README", pattern: "assets/workspace/README.md", min: 1 },
  {
    reason: "the seed note template",
    pattern: "assets/workspace/data/docs/templates/note.md",
    min: 1,
  },
  { reason: "the three seed views", pattern: "assets/workspace/data/docs/views/*.md", min: 3 },
];

export interface ForbiddenEntry {
  /** Why it must not ship — quoted verbatim in the failure. */
  readonly reason: string;
  readonly pattern: string;
}

/**
 * `data/**` and `.corpus/**` are anchored at the package root on purpose: the
 * *workspace* directories must never ship, while the **template's** `data/`
 * (`assets/workspace/data/**`) is exactly what `corpus init` installs. Prefixing
 * either pattern with a globstar would forbid the very thing the tool ships to
 * copy — hence the assertion in `pack-audit.test.ts` that neither is unanchored.
 */
export const FORBIDDEN_PACK_PATTERNS: readonly ForbiddenEntry[] = [
  { reason: "tests are not part of the tool", pattern: "**/*.test.{ts,tsx,js,mjs,cjs}" },
  {
    reason: "npm installs dependencies, tarballs do not carry them",
    pattern: "**/node_modules/**",
  },
  { reason: "the issue tracker is development state", pattern: "issues/**" },
  { reason: "the design mockup is development state", pattern: "design/**" },
  { reason: "the dev harness is not shipped to users", pattern: ".claude/**" },
  { reason: "git hooks belong to this repository, not to an install", pattern: ".githooks/**" },
  { reason: "CI configuration is development state", pattern: ".github/**" },
  { reason: "a workspace's documents are user data, never tool content", pattern: "data/**" },
  { reason: "a workspace's runtime state is user data", pattern: ".corpus/**" },
  { reason: "environment files never ship", pattern: "**/.env*" },
  { reason: "coverage output is development state", pattern: "**/coverage*/**" },
  {
    reason: "underscore-prefixed plugins are dev fixtures (sprint-012 Adjudication 9)",
    pattern: "plugins/_*/**",
  },
  {
    reason: "source maps would multiply the install size for no operator benefit",
    pattern: "**/*.map",
  },
  { reason: "TypeScript sources are bundled, never shipped", pattern: "**/*.{ts,tsx}" },
  { reason: "incremental build state is not tool content", pattern: "**/*.tsbuildinfo" },
];

/** The bin has to be executable, or `npx corpus` fails with EACCES. */
const EXECUTABLE_ENTRIES: readonly string[] = [CLI_BUNDLE_PATH];

const EXECUTABLE_BITS = 0o111;

/**
 * A tarball with a handful of files is a staging bug that would otherwise sail
 * through every exclusion. The floor is deliberately far below the real count
 * (~25 with an empty `plugins/`): it catches "nothing was staged", not drift.
 */
export const MINIMUM_PACKED_FILES = 15;

/**
 * Returns one human-readable violation per broken rule; empty means the tarball
 * is well-formed. Never throws — the runner decides what a violation costs.
 */
export function auditPackedFiles(files: readonly PackedFile[]): readonly string[] {
  const violations: string[] = [];
  const paths = files.map((file) => file.path);

  if (files.length < MINIMUM_PACKED_FILES) {
    violations.push(
      `the tarball holds ${String(files.length)} files, fewer than the ${String(
        MINIMUM_PACKED_FILES,
      )} a staged package must have — nothing was staged`,
    );
  }

  for (const entry of REQUIRED_PACK_ENTRIES) {
    const isMatch = picomatch(entry.pattern, { dot: true });
    const found = paths.filter((path) => isMatch(path)).length;
    if (found < entry.min) {
      violations.push(
        `missing ${entry.reason}: expected at least ${String(entry.min)} match of ` +
          `"${entry.pattern}", found ${String(found)}`,
      );
    }
  }

  for (const entry of FORBIDDEN_PACK_PATTERNS) {
    const isMatch = picomatch(entry.pattern, { dot: true });
    for (const path of paths.filter((candidate) => isMatch(candidate))) {
      violations.push(`"${path}" must not ship — ${entry.reason} ("${entry.pattern}")`);
    }
  }

  for (const required of EXECUTABLE_ENTRIES) {
    const entry = files.find((file) => file.path === required);
    if (entry === undefined) continue;
    if (entry.mode === undefined) {
      violations.push(`"${required}" was packed without a mode, so its executable bit is unproven`);
    } else if ((entry.mode & EXECUTABLE_BITS) === 0) {
      violations.push(
        `"${required}" is not executable (mode ${entry.mode.toString(8)}) — the bin must be`,
      );
    }
  }

  return violations;
}
