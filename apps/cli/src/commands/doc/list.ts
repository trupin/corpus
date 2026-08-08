import { DOC_SORTS, type DocList, type DocRow } from "@corpus/contract";
import type { paths } from "@corpus/contract/client";
import { parseTriStateBoolean, plural } from "../../input.js";
import type {
  FlagSpec,
  WorkspaceCommandContext,
  WorkspaceCommandSpec,
} from "../../registry/types.js";
import { oneLine, renderColumns } from "../columns.js";
import { collectDocFilters, DOC_FILTER_FLAGS, insertFlagAfter, oneOf } from "../filters.js";

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

/** The board's own filter, which ranked retrieval has no use for and does not accept. */
const PINNED_FLAG: FlagSpec = {
  name: "pinned",
  type: "boolean",
  description:
    "Only documents pinned to the board as columns (SPEC.md §11) — in practice `type: view` " +
    "documents. Selects the pinned side only.",
};

/**
 * The structural filter, and the one flag on this verb whose **name argues
 * against its meaning** (CONTRACT-042). `isParent=true` selects _roots_ —
 * documents with no parent — and the literal "has at least one child" reading
 * was considered and rejected upstream; the name is the one the user asked for
 * and is kept deliberately. Help text is where an agent learns what a flag does,
 * so the description spends its first two sentences saying what it selects and
 * its third denying the reading the name invites. The board solved the same
 * problem with `top-level only` / `children only`
 * (`apps/ui/src/board/query/grammar.ts`); do not "correct" either of them into
 * the other meaning.
 *
 * **A `true|false` value rather than a bare boolean**, unlike `--pinned` and
 * `--unread` above it. Those select their true side only and absent may safely
 * read as false; here `false` is a real query — the children the board's other
 * chip shows — so `true`, `false` and absent have to stay three distinct
 * answers, which is exactly what `parseTriStateBoolean` is for (`--evergreen`,
 * `--requests-agent`, `doc create --pinned`).
 *
 * The `--parent`/`--is-parent true` contradiction is documented **here** and not
 * on `--parent`: that flag is shared with `corpus search`, where this one does
 * not exist, and a rule stated on a flag whose partner is absent is a rule that
 * cannot be followed.
 */
const IS_PARENT_FLAG: FlagSpec = {
  name: "is-parent",
  type: "string",
  valueName: "true|false",
  description:
    "Whether the document is a **child of something** (SPEC.md §9.2). `true` selects **roots** — " +
    "documents with **no parent** — which is the board's _top-level only_; `false` selects the " +
    "documents that **are** a child of something, its _children only_. It does **not** mean " +
    "_has children_: a standalone note that nothing hangs off still matches `true`, because the " +
    "filter asks what a document is _under_, never what is under it. Omitting the flag filters " +
    "nothing — absent is not `false`, and the two are different questions. Not thread-only: a " +
    "non-thread document has no parent at all, so `true` genuinely keeps it and `false` " +
    "genuinely drops it, and a mixed top-level list of notes and standalone threads is the " +
    "point. `--parent <id>` alongside `--is-parent true` is a contradiction the server refuses " +
    "(`400`, exit 5) rather than answering with an empty set; `--parent <id> --is-parent false` " +
    "is merely redundant and is accepted.",
};

/**
 * The shared filters with this verb's own two spliced into the positions they
 * are published in — `--pinned` after `--unread`, `--is-parent` after
 * `--pinned`, which is the order `GET /api/docs` publishes its parameters in. A
 * filter added to the shared list still lands on both verbs with no edit here.
 */
const LIST_FILTER_FLAGS = insertFlagAfter(
  insertFlagAfter(DOC_FILTER_FLAGS, "unread", PINNED_FLAG),
  "pinned",
  IS_PARENT_FLAG,
);

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
 * The fourteen structured filters come from the shared module `corpus search`
 * also uses (`../filters.ts`), because the two endpoints are contracted to take
 * the same set. What is collected here is what is genuinely this verb's: the
 * optional `q`, the board's `--pinned`, the structural `--is-parent`, and the
 * ordering and paging a ranked top-k has no use for.
 */
function collectQuery(context: WorkspaceCommandContext): DocsListQuery {
  const { flags } = context;

  const q = flags.string("q");
  const sort = oneOf(context, "sort", DOC_SORTS);
  const limit = flags.number("limit");
  const offset = flags.number("offset");
  // Tri-state, and the tri-state is the whole point: `false` is the children
  // query, absent is no filter at all, and a bare boolean flag would collapse
  // the two into one — a caller asking for children would get everything.
  const isParent = parseTriStateBoolean("is-parent", flags.string("is-parent"));

  // Conditional spreads rather than assignment: under
  // `exactOptionalPropertyTypes` an explicit `undefined` is not an absent key,
  // and an absent key is exactly what "no such filter" means on the wire.
  return {
    ...(q === undefined ? {} : { q }),
    ...collectDocFilters(context),
    ...(sort === undefined ? {} : { sort }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    // Selects only its true side: absent means "no such filter", and the false
    // side is a query the board's chips do not offer either.
    ...(flags.boolean("pinned") ? { pinned: true } : {}),
    // `--is-parent false` *is* a query the board offers, so `false` is sent as
    // `false` rather than collapsed into absence. The contradiction with
    // `--parent` is left to the server: it owns the grammar, its `400` names the
    // pair, and a second copy of the rule here is a copy that can disagree.
    ...(isParent === undefined ? {} : { isParent }),
  };
}

/** One row per document, columns padded to the widest value in the page. */
function renderRows(items: readonly DocRow[]): readonly string[] {
  return renderColumns(
    items.map((item) => [item.id, item.type, item.status, title(item), item.path]),
  );
}

function title(item: DocRow): string {
  const collapsed = oneLine(item.title);
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
    "types rather than erroring. `--is-parent` is **not** one of them despite reading like one: " +
    "no document of any type carries a parent column, so a note's parent is null by genuinely " +
    "having none, and `--is-parent true` keeps it while `--is-parent false` drops it — an " +
    "answer, not a no-op.\n\n" +
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
    // The structured filters, from the one definition `corpus search` shares,
    // plus this verb's own two spliced back into their published positions
    // rather than the shared list being cut in pieces.
    ...LIST_FILTER_FLAGS,
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
  // Both sides of `--is-parent` get an example, deliberately. A reader who skims
  // the flag list and stops at the name concludes the wrong thing, and an
  // example line that says "top-level" is read where a paragraph is not.
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
      command: "corpus doc list --is-parent true",
      description:
        "Top-level only: every document that hangs off nothing, threads on documents excluded. " +
        "A note nobody has commented on is in this list — the flag asks what a document is " +
        "_under_, not what is under it.",
    },
    {
      command: "corpus doc list --is-parent false --type thread",
      description:
        "The other side: threads that are a child of some document, standalone threads excluded.",
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
