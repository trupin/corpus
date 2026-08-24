import { RETRIEVAL_DEFAULT_LIMIT, RETRIEVAL_MAX_LIMIT } from "@corpus/contract";
import type { paths } from "@corpus/contract/client";
import { oneLine, renderColumns } from "./columns.js";
import { collectDocFilters, DOC_FILTER_FLAGS } from "./filters.js";
import { semanticIndexNote } from "./retrieval.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../registry/types.js";

/**
 * `corpus search` — the retrieval verb, and the reason SPEC.md §1 can say the
 * agent "retrieves; it never enumerates" (SPEC.md §7 Retrieval discipline, §9.2).
 *
 * Before it existed, an agent looking for "what did we decide about the rate
 * assumptions" had two options through the CLI, and both cost the corpus rather
 * than the answer: list documents and read the plausible ones, or read
 * `data/docs/` off the disk. `GET /api/search` answers with **addresses**
 * instead — one hit per document: its id, the heading path of the best-matching
 * passage, and a single line of context. Never a body. Reading one is the next,
 * separate act: `corpus doc show <id>` on a hit's id.
 *
 * That is the whole verb: one typed call and a rendering. There is no
 * client-side filtering, no re-ranking and no truncation of the server's
 * snippet — the frugality is the endpoint's contract, and a CLI that trimmed a
 * body the server should not have sent would be hiding the bug rather than
 * fixing it.
 */

/** The route's own query type, so a contract rename fails the build, not the request. */
type SearchQuery = NonNullable<paths["/api/search"]["get"]["parameters"]["query"]>;

export async function runSearch(context: WorkspaceCommandContext): Promise<void> {
  const q = context.args.get("query");
  const limit = context.flags.number("limit");

  const query: SearchQuery = {
    q,
    ...collectDocFilters(context),
    ...(limit === undefined ? {} : { limit }),
  };

  const results = await context.client.request((api) =>
    api.GET("/api/search", { params: { query } }),
  );

  context.out.emit(results);

  const note = semanticIndexNote(results.semanticIndex);
  if (note !== undefined) context.out.line(note);

  if (results.hits.length === 0) {
    context.out.line("no documents match.");
    return;
  }

  // One hit is one line, in a fixed field order — id first, always — because
  // this output is read by an agent as well as by a person (SPEC.md §7).
  for (const line of renderColumns(
    results.hits.map((hit) => [hit.id, oneLine(hit.headingPath), oneLine(hit.snippet)]),
  )) {
    context.out.line(line);
  }
}

export const searchCommand: WorkspaceCommandSpec = {
  name: "search",
  summary: "Find where something is said in the corpus, without reading the corpus.",
  description:
    "Reads `GET /api/search` (SPEC.md §9.2) and prints one line per hit: the document id, the " +
    "heading path of the best-matching passage, and one line of context. **Never a body** — " +
    "that absence is the point of the verb. Reading is a separate, deliberate act on a hit's " +
    "id: `corpus doc show <id>`.\n\n" +
    "**This is how the agent locates content** (SPEC.md §7): searching, then reading the one or " +
    "two documents the ranking pointed at, costs what the answer costs. Listing the corpus and " +
    "reading candidates costs the corpus.\n\n" +
    "**The ranking hides the tool's own machinery by default** (SERVER-144): documents of type " +
    "`skill`, `agent-def` and `template` — the skills `corpus init` installed and the templates " +
    "it scaffolded — do not appear. Their worked examples are written in realistic domain prose " +
    "about rates, mortgages and filing, so they match the queries a real corpus produces and " +
    "displace the row you wanted: measured at **3 of 5 hits, the top one included**, on a " +
    "workspace holding one user note. **Naming any `--type` turns that default off entirely** — " +
    "the gate is whether you named a type at all, not whether you named an excluded one — so " +
    "`--type skill` finds the skills and `--type note,skill` finds both. They stay indexed " +
    "either way: this is a default about ranking, never a change to what is searchable. One " +
    "cost, stated here rather than discovered: a workspace whose _user_ writes documents of " +
    "type `template` needs `--type template` to search them.\n\n" +
    "**Views and boards are kept, deliberately.** This verb asks _where is this said?_, and a " +
    "board you named and can open is a real answer to that. The neighbour surfaces — `corpus " +
    "doc related` and `corpus thread context` — ask _what else bears on this?_, where a stored " +
    "query bears on nothing because it has no prose, so they drop `view` and `board` on top of " +
    "the three above. Their exclusion has **no override**: neither verb takes a type.\n\n" +
    "Threads are documents too, so a match inside a reply is a hit on the thread, and its " +
    "heading path is that turn's heading. A passage with no heading above it reports the " +
    "document's title, so a hit always has an address. Heading levels are joined for display by " +
    "a spaced `›` — print the path, never split it, since a heading may contain the " +
    "character.\n\n" +
    "It takes the same structured filters as `corpus doc list`, with the same meanings and the " +
    "same archived default, because both are built from one definition — the type default above " +
    "is this verb's own and applies on top of it. What it does **not** " +
    "take is `--sort`, `--pinned` or `--offset`: a ranked result set has one order — its " +
    `ranking — and is a top-k rather than a page. \`--limit\` (default ${String(RETRIEVAL_DEFAULT_LIMIT)}, ` +
    `max ${String(RETRIEVAL_MAX_LIMIT)}) is the cap; widen it or narrow the filters. ` +
    "Nothing matching is an empty ranking and exit 0, never an error.\n\n" +
    "`--json` emits the server's envelope unchanged — the hits plus each one's title, and the " +
    "`semanticIndex` state — which is what a skill parses when it wants a field rather than a " +
    "glance.",
  args: [
    {
      name: "query",
      required: true,
      description:
        "What to look for. Matched across document titles, bodies and turn bodies; quote it if " +
        "it contains spaces.",
    },
  ],
  flags: [
    ...DOC_FILTER_FLAGS,
    {
      name: "limit",
      type: "number",
      valueName: "n",
      description:
        `How many hits to return, 1–${String(RETRIEVAL_MAX_LIMIT)} (default ` +
        `${String(RETRIEVAL_DEFAULT_LIMIT)}). Lower than the list's cap on purpose: retrieval is ` +
        "read by an agent that pays for every line. There is no `--offset`.",
    },
  ],
  examples: [
    {
      command: 'corpus search "rate assumptions"',
      description:
        "One padded line per hit — id, heading path, snippet — best match first. Read the winner with `corpus doc show <id>`.",
    },
    {
      command: 'corpus search "mortgage" --type note --folder finance --limit 5',
      description:
        "The same structured filters `corpus doc list` takes, narrowing the ranking rather than enumerating what matched. Naming `--type` at all also lifts the default that hides `skill`, `agent-def` and `template` documents — here that changes nothing, since `note` excludes them anyway.",
    },
    {
      command: 'corpus search "reconcile in-progress" --type skill',
      description:
        "How to reach the installed skills, which the default ranking hides: name their type. This is the genesis lookup the comment skill makes before it writes a new skill, and it is the reason the default is a type gate rather than a hard exclusion.",
    },
    {
      command: 'corpus search "deadline" --json',
      description:
        'One JSON value: `{"hits":[{"id":"doc_a1b2c3","title":"Mortgage options",' +
        '"headingPath":"Mortgage options › Rates","snippet":"…the rate lock deadline is 30 June…"}],' +
        '"semanticIndex":"current"}`.',
    },
  ],
  handler: (context) => runSearch(context),
};
