import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
 *
 * ## Why the reads here are async (CLI-058)
 *
 * Nothing in this module does asynchronous I/O — every file is read with
 * `readFileSync`. The `async` is for the **`yaml` import**, and it is the whole
 * reason the signatures look like this.
 *
 * `yaml` is the only third-party package the CLI loads for a code path that runs
 * on one verb. A static `import … from "yaml"` puts it on the startup path of
 * *every* invocation — 15 ms to import on its own — and the agent loop is made
 * of hundreds of invocations (CLI-058). Deferring it to {@link yamlModule} costs
 * a migration detector one microtask and gives every other command that time
 * back: **10.1 ms off 168.7 ms, 6.0 %**, measured on the packaged bundle over 60
 * interleaved runs of `corpus health` with the two builds differing in this one
 * line.
 *
 * `startup-cost.test.ts` pins the set of packages the startup path may reach, so
 * a static import added here fails as a named diff rather than as a slow tool
 * nobody profiles.
 */

/**
 * `yaml`, loaded at most once per process and only when a document is actually
 * parsed. Memoised as the **promise** rather than the module, so concurrent
 * first callers share one load.
 */
let yamlModule: Promise<typeof import("yaml")> | undefined;

function yaml(): Promise<typeof import("yaml")> {
  yamlModule ??= import("yaml");
  return yamlModule;
}

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
export async function readWorkspaceCorpus(root: string, dataDir: string): Promise<WorkspaceCorpus> {
  const docsRoot = join(root, dataDir, "docs");
  const documents: DocumentOnDisk[] = [];
  for (const relative of markdownFilesUnder(docsRoot)) {
    const parsed = await readDocument(join(docsRoot, ...relative.split("/")));
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
async function readDocument(absolute: string): Promise<Omit<DocumentOnDisk, "path"> | null> {
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
  const frontmatter = await parseFrontmatter(raw);
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
 * `yaml` library rather than a hand-rolled scanner (SPEC.md §5) — loaded on
 * first use rather than at startup, which is what the `async` buys.
 */
export async function parseFrontmatter(raw: string): Promise<Record<string, unknown> | null> {
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw;
  const lines = text.split("\n");
  if (!isFence(lines[0])) return null;

  const body: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (isFence(lines[index])) return await mappingOf(body.join("\n"));
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

async function mappingOf(source: string): Promise<Record<string, unknown> | null> {
  const { parse } = await yaml();
  let parsed: unknown;
  try {
    parsed = parse(source) as unknown;
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
