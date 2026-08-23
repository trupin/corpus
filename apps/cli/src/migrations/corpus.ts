import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * The workspace's documents, read straight off disk, read-only (CLI-061).
 *
 * A data migration is detected from **files**, never from the server: SPEC.md
 * §2.4 has an upgrade report the migrations a workspace needs, and an upgrade is
 * exactly the moment the server may be stopped — `corpus upgrade` stops it
 * itself before npm rewrites the package this process runs from. A detector that
 * needed a socket would report nothing at the one moment it is asked.
 *
 * It is also why nothing here is a validator. `corpus doc check` owns "is this
 * file well formed"; a file that will not parse is **skipped** here rather than
 * failed, because a migration report that refuses to run because of an unrelated
 * broken file tells the operator nothing about the migration.
 */

/** The frontmatter of one file under `data/docs/`, exactly as written. */
export interface DocumentOnDisk {
  /** Workspace-relative, `/`-separated, so it reads the same on every platform. */
  readonly path: string;
  /** `id` as the file carries it, or `null` when it carries none. */
  readonly id: string | null;
  /** `type` as the file carries it, or `null`. */
  readonly type: string | null;
  readonly title: string | null;
  /** Every frontmatter key, undefaulted and uncoerced — "what the file says". */
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

export interface WorkspaceCorpus {
  readonly root: string;
  /** Every parsable `data/docs/**\/*.md`, ordered by path. */
  readonly documents: readonly DocumentOnDisk[];
}

/** A UTF-8 byte-order mark, written as its escape so it is visible in this source. */
const BOM = "\uFEFF";

/**
 * Reads every document under `<root>/<dataDir>/docs`. A missing tree is an empty
 * corpus, not a failure: `corpus upgrade` runs outside a fully-formed workspace
 * often enough that refusing there would cost the tool half of §2.4.
 */
export function readWorkspaceCorpus(root: string, dataDir: string): WorkspaceCorpus {
  const docsRoot = join(root, dataDir, "docs");
  const documents: DocumentOnDisk[] = [];
  for (const relative of markdownFilesUnder(docsRoot)) {
    const parsed = readDocument(join(docsRoot, ...relative.split("/")));
    if (parsed === null) continue;
    documents.push({ ...parsed, path: `${dataDir}/docs/${relative}` });
  }
  return { root, documents };
}

/** Every `.md` under `directory`, `/`-separated and sorted, or none when it is absent. */
function markdownFilesUnder(directory: string): readonly string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // Absent, or unreadable. Either way there is nothing here to migrate, and
    // an upgrade is not the command that should fail over it.
    return [];
  }
  const found: string[] = [];
  for (const entry of [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (entry.isDirectory()) {
      for (const nested of markdownFilesUnder(join(directory, entry.name))) {
        found.push(`${entry.name}/${nested}`);
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(entry.name);
    }
  }
  return found;
}

/** One file's frontmatter, or `null` when it has none this reader can use. */
function readDocument(absolute: string): Omit<DocumentOnDisk, "path"> | null {
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
  const frontmatter = parseFrontmatter(raw);
  if (frontmatter === null) return null;
  return {
    id: stringOrNull(frontmatter.id),
    type: stringOrNull(frontmatter.type),
    title: stringOrNull(frontmatter.title),
    frontmatter,
  };
}

/**
 * The YAML mapping between the leading `---` fence and the next one.
 *
 * Deliberately smaller than the server's parser (`apps/server/src/core/document.ts`):
 * that one preserves the source so it can write the file back, and this one only
 * ever reads. What the two must agree on is where the fences are, and that is
 * the whole of what is duplicated here — the CLI may not import from the server
 * (CLAUDE.md dependency direction), and the parse itself goes through the same
 * `yaml` library rather than a hand-rolled scanner (SPEC.md §5).
 */
export function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw;
  const lines = text.split("\n");
  if (!isFence(lines[0])) return null;

  const body: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (isFence(lines[index])) return mappingOf(body.join("\n"));
    body.push(stripCr(lines[index] ?? ""));
  }
  // Unterminated: not a document. `corpus doc check` is what says so.
  return null;
}

function isFence(line: string | undefined): boolean {
  return line !== undefined && stripCr(line) === "---";
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function mappingOf(source: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = parseYaml(source) as unknown;
  } catch {
    return null;
  }
  // `parseYaml("")` is `null`: an empty frontmatter block is a document with no
  // keys, which is a fine answer here — it simply carries nothing to migrate.
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
