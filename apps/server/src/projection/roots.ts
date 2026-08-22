// Document roots and their enumeration (SPEC.md §4, §7, §9.1).
//
// `data/` is the corpus; `.claude/skills/`, `.claude/skills-archived/` and
// `.claude/agents/` are additional document roots because a `SKILL.md` is
// already markdown with YAML frontmatter — Corpus's own format — so skills and
// agent definitions are indexed in place rather than synced into a second copy
// (§7). Anything outside a root is not a document, full stop.

import { readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { DocStatus } from "@corpus/contract";

export const SKILL_FILENAME = "SKILL.md";

/** Which files inside a root are documents. */
export type RootShape =
  /** Any `*.md`, at any depth. */
  | "markdown-tree"
  /** Any `*.md`, directly in the root only. */
  | "markdown-flat"
  /** Only files named `SKILL.md`, at any depth. */
  | "skill-tree";

export type DocumentRoot = {
  readonly key: "docs" | "threads" | "skills" | "skills-archived" | "agents";
  /** Workspace-relative POSIX path of the root directory. */
  readonly path: string;
  readonly shape: RootShape;
  /** Type every document under this root takes, overriding frontmatter; `null` keeps the frontmatter's. */
  readonly type: string | null;
  /** Status every document under this root takes, overriding frontmatter; `null` keeps the frontmatter's. */
  readonly status: DocStatus | null;
  /** True when a file here may be indexed without Corpus frontmatter, under a synthetic id (§7). */
  readonly synthesizeId: boolean;
  /** Prefix of the synthetic id, when {@link DocumentRoot.synthesizeId} is set. */
  readonly idPrefix: string;
};

/**
 * The corpus proper. Named on its own because two callers need *this* root
 * rather than the list — `projection/unindexable.ts` walks it and asks
 * {@link classifyPath} what it would refuse — and a `find` over
 * {@link DOCUMENT_ROOTS} would make a total lookup carry an unreachable
 * "no such root" branch.
 */
export const DOCS_ROOT: DocumentRoot = {
  key: "docs",
  path: "data/docs",
  shape: "markdown-tree",
  type: null,
  status: null,
  synthesizeId: false,
  idPrefix: "doc",
};

/**
 * The five roots, in the order enumeration visits them. `data/docs` and
 * `data/threads` are spelled out rather than derived from the config's
 * `dataDir`, matching `core/paths.ts`: the layout §4 fixes is what every path
 * helper in the system already assumes, and one deriving it differently would
 * be a silent split-brain.
 */
export const DOCUMENT_ROOTS: readonly DocumentRoot[] = [
  DOCS_ROOT,
  {
    key: "threads",
    path: "data/threads",
    shape: "markdown-flat",
    type: "thread",
    status: null,
    synthesizeId: false,
    idPrefix: "th",
  },
  {
    key: "skills",
    path: ".claude/skills",
    shape: "skill-tree",
    type: "skill",
    status: null,
    synthesizeId: true,
    idPrefix: "skill",
  },
  {
    key: "skills-archived",
    path: ".claude/skills-archived",
    shape: "skill-tree",
    type: "skill",
    // Archiving a skill *is* moving its folder here (§7); the file itself keeps
    // whatever status it was archived with, so the root is the only honest
    // source for "this skill is disabled".
    status: "archived",
    synthesizeId: true,
    idPrefix: "skill",
  },
  {
    key: "agents",
    path: ".claude/agents",
    shape: "markdown-flat",
    type: "agent-def",
    status: null,
    synthesizeId: true,
    idPrefix: "agentdef",
  },
];

/** Directory names never descended into, whatever root they appear under. */
const IGNORED_DIRECTORIES = new Set(["node_modules"]);

const toPosix = (path: string): string => path.split(sep).join("/");

/** Workspace-relative POSIX path of `absPath`, or `null` when it escapes the workspace. */
export function workspaceRelativePath(workspaceRoot: string, absPath: string): string | null {
  const rel = relative(resolve(workspaceRoot), resolve(absPath));
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) return null;
  return toPosix(rel);
}

const matchesShape = (shape: RootShape, filename: string, depth: number): boolean => {
  switch (shape) {
    case "markdown-tree":
      return filename.endsWith(".md");
    case "markdown-flat":
      return depth === 0 && filename.endsWith(".md");
    case "skill-tree":
      return filename === SKILL_FILENAME;
  }
};

/**
 * The root a workspace-relative path belongs to, or `null` for everything else
 * — non-markdown files, dotfiles, `node_modules`, a nested thread, a `.md` next
 * to a `SKILL.md`. Pure string arithmetic: no filesystem access, so the watcher
 * (SERVER-007) can classify a deletion whose file is already gone.
 */
export function classifyPath(relativePath: string): DocumentRoot | null {
  const normalized = toPosix(relativePath);
  for (const root of DOCUMENT_ROOTS) {
    const prefix = `${root.path}/`;
    if (!normalized.startsWith(prefix)) continue;
    const rest = normalized.slice(prefix.length);
    const segments = rest.split("/");
    const filename = segments.at(-1);
    if (filename === undefined || filename === "") return null;
    if (segments.some((segment) => segment.startsWith(".") || IGNORED_DIRECTORIES.has(segment))) {
      return null;
    }
    return matchesShape(root.shape, filename, segments.length - 1) ? root : null;
  }
  return null;
}

export type EnumeratedFile = {
  readonly root: DocumentRoot;
  readonly absPath: string;
  /** Workspace-relative POSIX path — the `documents.path` value. */
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
};

type WalkState = {
  readonly root: DocumentRoot;
  readonly workspaceRoot: string;
  readonly visitedDirs: Set<string>;
  readonly seenFiles: Set<string>;
  readonly out: EnumeratedFile[];
};

/**
 * `readdirSync(..., { recursive: true })` does not descend through symlinked
 * directories, and plugin skills are symlinked into `.claude/skills` (§10) — so
 * the walk is explicit, resolving each entry and de-duplicating by real path so
 * one file reachable through two links is indexed once.
 */
function walk(state: WalkState, dir: string, depth: number): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A root that does not exist is simply empty, and a directory that vanished
    // mid-walk is a removal — neither is a projection failure.
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const abs = join(dir, entry.name);

    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const target = statSync(abs);
        isDirectory = target.isDirectory();
        isFile = target.isFile();
      } catch {
        continue;
      }
    }

    if (isDirectory) {
      let real: string;
      try {
        real = realpathSync(abs);
      } catch {
        continue;
      }
      // Guards against a symlink loop and against two links to one directory.
      if (state.visitedDirs.has(real)) continue;
      state.visitedDirs.add(real);
      walk(state, abs, depth + 1);
      continue;
    }

    if (!isFile || !matchesShape(state.root.shape, entry.name, depth)) continue;

    let stats;
    let real: string;
    try {
      stats = statSync(abs);
      real = realpathSync(abs);
    } catch {
      continue;
    }
    if (state.seenFiles.has(real)) continue;
    state.seenFiles.add(real);

    const path = workspaceRelativePath(state.workspaceRoot, abs);
    if (path === null) continue;
    state.out.push({
      root: state.root,
      absPath: abs,
      path,
      size: stats.size,
      mtimeMs: Math.trunc(stats.mtimeMs),
    });
  }
}

/**
 * Every document file under every root, sorted by workspace-relative path.
 * Sorted because path order is the tie-break for duplicate ids and the thing
 * that makes two rebuilds byte-identical (§12 M1).
 */
export function enumerateDocuments(workspaceRoot: string): EnumeratedFile[] {
  const absoluteRoot = resolve(workspaceRoot);
  const seenFiles = new Set<string>();
  const out: EnumeratedFile[] = [];
  for (const root of DOCUMENT_ROOTS) {
    const dir = join(absoluteRoot, ...root.path.split("/"));
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    walk(
      { root, workspaceRoot: absoluteRoot, visitedDirs: new Set([real]), seenFiles, out },
      dir,
      0,
    );
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
