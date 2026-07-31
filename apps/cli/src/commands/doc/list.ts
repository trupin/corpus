import {
  ACTORS,
  DOC_SORTS,
  DOC_STATUSES,
  NEEDS_FILTERS,
  STALE_TIERS,
  THREAD_AGENT_STATES,
  type DocList,
  type DocRow,
} from "@corpus/contract";
import type { paths } from "@corpus/contract/client";
import { UsageError } from "../../errors.js";
import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus doc list` — the enumeration verb (SPEC.md §9.2, §11). Until it
 * existed, an agent that reaches the workspace only through the CLI could read a
 * document it already knew the id of and nothing else: "what is in the corpus"
 * was answerable only by walking the filesystem, which answers with files rather
 * than with documents and cannot see status, staleness or Attention at all.
 *
 * It is one call onto `GET /api/docs` — the same collection query the board's
 * columns, the search overlay and every autocomplete compose — with the whole
 * documented filter grammar passed through unchanged. The CLI adds no filtering
 * of its own: a row it printed is a row the server selected.
 *
 * **A page is never presented as the whole set.** The route is offset-paginated
 * and the server applies its own default limit, so the human rendering always
 * ends in a line stating what was shown out of what matched, and names the
 * `--offset` that fetches the next page. `--json` carries the server's `page`
 * meta for the same reason: an agent makes filing decisions from this output,
 * and a silently truncated list is how it decides wrongly.
 */

/** A title long enough to wreck the columns is cut here; `--json` has it whole. */
const MAX_TITLE = 60;

/**
 * The route's own query type, so a filter the contract renames or retypes stops
 * this verb compiling instead of silently going nowhere on the wire.
 */
type DocsListQuery = NonNullable<paths["/api/docs"]["get"]["parameters"]["query"]>;

export async function runDocList(context: WorkspaceCommandContext): Promise<void> {
  const query = collectQuery(context);

  const result = await context.client.request((api) =>
    api.GET("/api/docs", Object.keys(query).length === 0 ? {} : { params: { query } }),
  );

  context.out.emit(result);

  if (result.items.length === 0) {
    context.out.line(
      result.page.offset === 0 ? "no documents match." : "no documents on this page.",
    );
    return;
  }

  for (const line of renderRows(result.items)) context.out.line(line);
  context.out.line(renderTally(result));
}

/**
 * The wire query, built only from the flags actually passed. Every parameter of
 * the route is here — a filter the agent cannot reach from the CLI is a filter
 * it has to re-implement by reading every row.
 *
 * The enumerated values are checked against the contract's own lists rather than
 * sent for the server to reject: `--from`'s precedent (`input.ts`) is that a
 * misspelled enum is a usage error naming the alternatives, not a `400` the
 * server had to be asked for. Open-valued parameters — `type`, `tag`, `folder`,
 * `due`, ids — are passed through verbatim, because the CLI does not know the
 * plugin types, the workspace's tags or its folders, and pretending otherwise
 * would refuse valid queries.
 */
function collectQuery(context: WorkspaceCommandContext): DocsListQuery {
  const { flags } = context;

  const q = flags.string("q");
  const type = flags.string("type");
  const tag = flags.string("tag");
  const folder = flags.string("folder");
  const status = oneOf(context, "status", DOC_STATUSES);
  const parent = flags.string("parent");
  const references = flags.string("references");
  const agent = oneOf(context, "agent", THREAD_AGENT_STATES);
  const author = oneOf(context, "author", ACTORS);
  const since = flags.string("since");
  const due = flags.string("due");
  const stale = oneOf(context, "stale", STALE_TIERS);
  const needs = oneOf(context, "needs", NEEDS_FILTERS);
  const sort = oneOf(context, "sort", DOC_SORTS);
  const limit = flags.number("limit");
  const offset = flags.number("offset");

  // Conditional spreads rather than assignment: under
  // `exactOptionalPropertyTypes` an explicit `undefined` is not an absent key,
  // and an absent key is exactly what "no such filter" means on the wire.
  return {
    ...(q === undefined ? {} : { q }),
    ...(type === undefined ? {} : { type }),
    ...(tag === undefined ? {} : { tag }),
    ...(folder === undefined ? {} : { folder }),
    ...(status === undefined ? {} : { status }),
    ...(parent === undefined ? {} : { parent }),
    ...(references === undefined ? {} : { references }),
    ...(agent === undefined ? {} : { agent }),
    ...(author === undefined ? {} : { author }),
    ...(since === undefined ? {} : { since }),
    ...(due === undefined ? {} : { due }),
    ...(stale === undefined ? {} : { stale }),
    ...(needs === undefined ? {} : { needs }),
    ...(sort === undefined ? {} : { sort }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    // These select only their true side: absent means "no such filter", and the
    // false side is a query the board's chips do not offer either.
    ...(flags.boolean("include-archived") ? { includeArchived: true } : {}),
    ...(flags.boolean("unread") ? { unread: true } : {}),
    ...(flags.boolean("pinned") ? { pinned: true } : {}),
  };
}

function oneOf<T extends string>(
  context: WorkspaceCommandContext,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = context.flags.string(name);
  if (value === undefined) return undefined;

  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new UsageError(`--${name} must be one of: ${allowed.join(", ")} — got "${value}".`);
  }
  return match;
}

/** One row per document, columns padded to the widest value in the page. */
function renderRows(items: readonly DocRow[]): readonly string[] {
  const cells = items.map((item) => [item.id, item.type, item.status, title(item), item.path]);
  // The last column is left ragged: padding a path to the widest one in the
  // page adds trailing spaces to every line and buys nothing.
  const widths = cells[0]?.slice(0, -1).map((_, column) => widest(cells, column)) ?? [];

  return cells.map((row) =>
    row
      .map((cell, column) => (column < widths.length ? pad(cell, widths[column]) : cell))
      .join("  "),
  );
}

function widest(cells: readonly (readonly string[])[], column: number): number {
  return cells.reduce((max, row) => Math.max(max, row[column]?.length ?? 0), 0);
}

function pad(cell: string, width = 0): string {
  return cell.padEnd(width);
}

function title(item: DocRow): string {
  const collapsed = item.title.replace(/\s+/g, " ").trim();
  if (collapsed === "") return "(untitled)";
  return collapsed.length <= MAX_TITLE ? collapsed : `${collapsed.slice(0, MAX_TITLE - 1)}…`;
}

/**
 * The line that keeps a page from reading like a result set. It states the range
 * shown out of the total that matched and, when there is more, the exact
 * `--offset` that continues — so "is that everything?" is never a guess.
 */
function renderTally(result: DocList): string {
  const { total, offset } = result.page;
  const end = offset + result.items.length;
  const shown = `showing ${String(offset + 1)}–${String(end)} of ${plural(total, "document")}`;
  return end < total ? `${shown} — next page: --offset ${String(end)}` : shown;
}

export const listCommand: WorkspaceCommandSpec = {
  name: "list",
  summary: "Query the document collection: what is in the corpus, and what needs attention.",
  description:
    "Reads `GET /api/docs`, the single collection query behind every list (SPEC.md §9.2) — the " +
    "same one the board's columns and the search overlay compose. Values OR within a " +
    "comma-separated flag and AND across flags, so `--type note,view --tag finance` reads " +
    '"notes or views tagged finance". Threads are documents too: `--type thread` lists them, and ' +
    "the thread-only filters (`--parent`, `--agent`, `--author`, `--unread`) no-op for other " +
    "types rather than erroring.\n\n" +
    "Archived documents are **excluded by default** (SPEC.md §11). `--status archived` selects " +
    "them alone; `--include-archived` widens the default set to the union.\n\n" +
    "**The list is paginated and says so.** The server applies its own page limit, and the last " +
    "line always states the range shown out of the total that matched, naming the `--offset` " +
    "that fetches the next page when there is one. Under `--json` the server's `{items, page}` " +
    "envelope is emitted unchanged — `page` is what makes the truncation visible to a caller " +
    "that is not reading the human line, and every row carries its `extra` frontmatter, its " +
    "Attention reasons and its thread affordances, so a skill parses one response instead of " +
    "issuing a read per row.\n\n" +
    "A misspelled value for one of the enumerated filters (`--status`, `--sort`, `--needs`, " +
    "`--stale`, `--agent`, `--author`) is a usage error listing the alternatives, and no request " +
    "is sent. The open ones — `--type`, `--tag`, `--folder`, `--due` — are passed through " +
    "verbatim, since plugins define their own types and the CLI does not know the workspace's " +
    "tags or folders.",
  args: [],
  flags: [
    {
      name: "q",
      type: "string",
      valueName: "text",
      description:
        "Full-text query across titles, bodies and turn bodies. Matching rows carry `snippets`, " +
        "which `--json` includes; `--sort relevance` needs this flag and is refused without it.",
    },
    {
      name: "type",
      type: "string",
      valueName: "a,b",
      description:
        "Comma-separated document types; values OR together. Core types: `note`, `thread`, " +
        "`view`, `template`, `skill`, `agent-def`, plus whatever a plugin defines.",
    },
    {
      name: "tag",
      type: "string",
      valueName: "a,b",
      description: "Comma-separated tags; values OR together.",
    },
    {
      name: "folder",
      type: "string",
      valueName: "path",
      description:
        "Path prefix under `data/docs/`, matching the folder and its descendants. Threads inherit " +
        "their parent's folder.",
    },
    {
      name: "status",
      type: "string",
      valueName: "status",
      description: `Lifecycle status: ${DOC_STATUSES.join(", ")}. Passing it replaces the default archived exclusion.`,
    },
    {
      name: "include-archived",
      type: "boolean",
      description:
        "Include archived documents **alongside** the rest, rather than excluding them — the " +
        "board's archived chip. A no-op next to an explicit `--status`.",
    },
    {
      name: "needs",
      type: "string",
      valueName: "reason",
      description: `The Attention filter (SPEC.md §11): ${NEEDS_FILTERS.join(", ")}. \`me\` is the union of every reason.`,
    },
    {
      name: "parent",
      type: "string",
      valueName: "doc-id",
      description: "Threads whose parent is this document. Thread-only.",
    },
    {
      name: "references",
      type: "string",
      valueName: "doc-id",
      description: "Documents whose body contains `[[<doc-id>]]` — the backlinks of that document.",
    },
    {
      name: "agent",
      type: "string",
      valueName: "state",
      description: `Agent participation state: ${THREAD_AGENT_STATES.join(", ")}. Thread-only.`,
    },
    {
      name: "author",
      type: "string",
      valueName: "user|agent",
      description: "Author of the thread's last turn. Thread-only.",
    },
    {
      name: "unread",
      type: "boolean",
      description:
        "Only threads whose last turn is newer than your last-seen mark. Thread-only, and it " +
        "selects the unread side only — there is no flag for the read side.",
    },
    {
      name: "pinned",
      type: "boolean",
      description:
        "Only documents pinned to the board as columns (SPEC.md §11) — in practice `type: view` " +
        "documents. Selects the pinned side only.",
    },
    {
      name: "due",
      type: "string",
      valueName: "date|keyword",
      description:
        "An ISO date (due on or before it) or one of `overdue`, `today`, `week`, resolved against " +
        "the workspace's clock.",
    },
    {
      name: "since",
      type: "string",
      valueName: "iso",
      description: "Documents updated strictly after this ISO 8601 instant.",
    },
    {
      name: "stale",
      type: "string",
      valueName: "tier",
      description: `Staleness tier (SPEC.md §5) and beyond: ${STALE_TIERS.join(", ")}. Evergreen documents never match.`,
    },
    {
      name: "sort",
      type: "string",
      valueName: "key",
      description: `Sort key: ${DOC_SORTS.join(", ")}. Defaults to \`-updated\` (newest first).`,
    },
    {
      name: "limit",
      type: "number",
      valueName: "n",
      description: "Rows per page, 1–200. The server applies its own default when omitted.",
    },
    {
      name: "offset",
      type: "number",
      valueName: "n",
      description: "Rows to skip — how the tally line's next page is fetched.",
    },
  ],
  examples: [
    {
      command: "corpus doc list",
      description:
        "One padded line per document — id, type, status, title, path — then the tally of what was shown out of what matched.",
    },
    {
      command: "corpus doc list --type skill",
      description:
        "Every installed skill, which is how the agent sees what it already knows how to do before writing a new one (SPEC.md §7).",
    },
    {
      command: "corpus doc list --needs me --folder finance",
      description: "What wants attention inside one folder — the board's Attention view, filtered.",
    },
    {
      command: "corpus doc list --type thread --unread --json",
      description:
        'One JSON value: `{"items":[{"id":"th_x9y8","type":"thread","title":"Rate assumptions",' +
        '"parent":"doc_a1b2c3","unread":true,"attention":["unread-reply"],"extra":{},…}],' +
        '"page":{"total":3,"limit":50,"offset":0}}`.',
    },
  ],
  handler: (context) => runDocList(context),
};
