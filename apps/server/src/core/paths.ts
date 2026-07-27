import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

/**
 * The workspace path convention (SPEC.md §4, §5). **Path is presentation, id is
 * identity** — the projection maps id → path, and nothing downstream may derive
 * meaning from where a file happens to sit. Threads are therefore flat and
 * named by id, while documents nest freely for the operator's benefit.
 *
 * This module is pure string arithmetic: no filesystem access, no existence
 * checks. Callers do the I/O.
 */

export const DATA_ROOT = "data";
export const DOCS_ROOT = "data/docs";
export const THREADS_ROOT = "data/threads";
/** Where a document with no folder lands — the operator's triage queue (§4). */
export const DEFAULT_DOC_FOLDER = "inbox";
/** Long enough to stay readable, short enough to survive every filesystem. */
export const MAX_SLUG_LENGTH = 60;

export class PathTraversalError extends Error {
  override readonly name = "PathTraversalError";
  constructor(readonly path: string) {
    super(`Path escapes the workspace: ${path}`);
  }
}

/** Normalize to POSIX separators; workspace-relative paths are always written with `/`. */
const toPosix = (path: string): string => path.split(sep).join("/");

/**
 * True when `path` is a relative path that stays inside the workspace. Absolute
 * paths, `..` segments that escape, and Windows drive letters are all rejected
 * — every caller taking user- or agent-supplied path input goes through this.
 */
export const isWorkspaceRelative = (path: string): boolean => {
  if (path === "" || isAbsolute(path) || /^[A-Za-z]:/.test(path)) return false;
  const normalized = toPosix(normalize(path));
  return normalized !== ".." && !normalized.startsWith("../") && !normalized.startsWith("/");
};

/** Resolve a workspace-relative path against the workspace root, or throw. */
export const resolveInWorkspace = (workspaceRoot: string, path: string): string => {
  if (!isWorkspaceRelative(path)) throw new PathTraversalError(path);
  const absolute = resolve(workspaceRoot, path);
  const inside = relative(resolve(workspaceRoot), absolute);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new PathTraversalError(path);
  return absolute;
};

/**
 * Slugify a title for use as a filename. Diacritics are decomposed and dropped
 * (so "Café" becomes "cafe"), runs of anything else collapse to a single
 * hyphen, and the result is capped. Titles that reduce to nothing — an
 * all-emoji or all-CJK title — yield `""`; {@link documentPathFor} falls back
 * to the id, which is always filesystem-safe.
 */
export const slugifyTitle = (title: string): string =>
  title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");

/**
 * Normalize a folder hint to a path under {@link DOCS_ROOT}. Callers pass either
 * a bare folder (`"finance"`, as the contract's `CreateDocRequest` declares) or
 * the full workspace-relative form (`"data/docs/finance"`); both mean the same
 * place, and disagreeing about it is not worth a runtime error.
 */
export const normalizeDocFolder = (folder: string | undefined): string => {
  const trimmed = (folder ?? DEFAULT_DOC_FOLDER).trim().replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return DOCS_ROOT;
  const withoutRoot =
    trimmed === DOCS_ROOT
      ? ""
      : trimmed.startsWith(`${DOCS_ROOT}/`)
        ? trimmed.slice(DOCS_ROOT.length + 1)
        : trimmed;
  if (withoutRoot === "") return DOCS_ROOT;
  const path = toPosix(normalize(`${DOCS_ROOT}/${withoutRoot}`));
  // `..` inside the hint would resolve to a real path that is simply somewhere
  // else in the workspace, which is worse than an escape: it would file a
  // document outside the document root without anything looking wrong.
  if (path !== DOCS_ROOT && !path.startsWith(`${DOCS_ROOT}/`))
    throw new PathTraversalError(folder ?? "");
  return path;
};

export type DocumentPathInput = {
  readonly id: string;
  readonly type: string;
  readonly title: string;
};

export type DocumentPathOptions = {
  /** Folder under `data/docs/`; ignored for threads, which are always flat. */
  readonly folder?: string;
};

/**
 * The workspace-relative path a document should live at. Threads are flat at
 * `data/threads/<id>.md` regardless of any folder hint — their filename is
 * their id because nothing ever browses them by name.
 */
export const documentPathFor = (
  document: DocumentPathInput,
  options: DocumentPathOptions = {},
): string => {
  if (document.type === "thread") return `${THREADS_ROOT}/${document.id}.md`;
  const folder = normalizeDocFolder(options.folder);
  const slug = slugifyTitle(document.title);
  const path = `${folder}/${slug === "" ? document.id : slug}.md`;
  if (!isWorkspaceRelative(path)) throw new PathTraversalError(path);
  return path;
};

export type ParsedDocumentPath = {
  readonly root: "docs" | "threads";
  /** Folder below the root, `""` at the root itself. Never leading or trailing `/`. */
  readonly folder: string;
  readonly filename: string;
};

/**
 * Decompose a workspace-relative document path. Returns `null` for anything
 * that is not a markdown file under one of the two document roots, including
 * every path that would escape the workspace.
 */
export const parseDocumentPath = (path: string): ParsedDocumentPath | null => {
  if (!isWorkspaceRelative(path)) return null;
  const normalized = toPosix(normalize(path));
  if (!normalized.endsWith(".md")) return null;

  const root = normalized.startsWith(`${THREADS_ROOT}/`)
    ? ("threads" as const)
    : normalized.startsWith(`${DOCS_ROOT}/`)
      ? ("docs" as const)
      : null;
  if (root === null) return null;

  const rest = normalized.slice((root === "threads" ? THREADS_ROOT : DOCS_ROOT).length + 1);
  const lastSlash = rest.lastIndexOf("/");
  const folder = lastSlash === -1 ? "" : rest.slice(0, lastSlash);
  const filename = lastSlash === -1 ? rest : rest.slice(lastSlash + 1);
  // Threads are flat by convention; a nested one is not a thread path.
  if (filename === "" || (root === "threads" && folder !== "")) return null;
  return { root, folder, filename };
};
