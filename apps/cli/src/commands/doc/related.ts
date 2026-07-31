import { RETRIEVAL_DEFAULT_LIMIT, RETRIEVAL_MAX_LIMIT } from "@corpus/contract";
import type { paths } from "@corpus/contract/client";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { oneLine, renderColumns } from "../columns.js";
import { semanticIndexNote } from "../retrieval.js";

/**
 * `corpus doc related` — the second half of retrieval (SPEC.md §7, §9.2): once
 * the agent holds one relevant id, this is how it reaches the documents around
 * it without a query and without a sweep.
 *
 * Phase A expands through the only graph the workspace has: the `[[ref]]` link
 * table, outgoing, incoming and mutual, with the mutual ones ranked first. Every
 * row is a document that **exists** — the projection deliberately stores
 * references to documents nobody has created yet (SPEC.md §9.1), and handing the
 * agent an id it cannot then read would be worse than omitting the row. From
 * Phase B semantically similar documents join the same ranked list, which is why
 * every row carries its `relation` today.
 *
 * The row is as frugal as a search hit: id, why it is related, one line to
 * recognise it by. The body is `corpus doc show <id>`, deliberately separate.
 */

/** The route's own query type, so a contract rename fails the build, not the request. */
type RelatedQuery = NonNullable<paths["/api/docs/{id}/related"]["get"]["parameters"]["query"]>;

export async function runDocRelated(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");
  const limit = context.flags.number("limit");

  const query: RelatedQuery = {
    ...(limit === undefined ? {} : { limit }),
    ...(context.flags.boolean("include-archived") ? { includeArchived: true } : {}),
  };

  const result = await context.client.request((api) =>
    api.GET("/api/docs/{id}/related", { params: { path: { id }, query } }),
  );

  context.out.emit(result);

  const note = semanticIndexNote(result.semanticIndex);
  if (note !== undefined) context.out.line(note);

  if (result.related.length === 0) {
    context.out.line("no related documents.");
    return;
  }

  // Same shape as a search hit's line, and for the same reason: id first, one
  // document per line, nothing an agent has to unwrap.
  for (const line of renderColumns(
    result.related.map((doc) => [doc.id, doc.relation, oneLine(doc.excerpt)]),
  )) {
    context.out.line(line);
  }
}

export const relatedCommand: WorkspaceCommandSpec = {
  name: "related",
  summary: "Expand from one document to the documents around it.",
  description:
    "Reads `GET /api/docs/{id}/related` (SPEC.md §9.2) and prints one line per neighbour: the " +
    "document id, why it is related, and one line to recognise it by — **never a body**. The " +
    "body of one that looks right is `corpus doc show <id>`.\n\n" +
    "This is the follow-up move to `corpus search`: search finds an entry point, this walks out " +
    "from it. Phase A relates through the reference graph — an outgoing `[[ref]]`, a backlink, " +
    "or both directions, which ranks first — so every row is labelled `linked`. `similar` and " +
    "`both` arrive with semantic retrieval (SPEC.md §9.1) and are already in the vocabulary, so " +
    "nothing about this output changes shape when they do.\n\n" +
    "Threads are documents, so a thread whose reply mentions this document is a legitimate " +
    "neighbour and appears as one. Every id printed is a document that exists and can be read: " +
    "references to documents nobody has created yet are real in the corpus but are not offered " +
    "here. Archived neighbours are excluded by default, like every list — `--include-archived` " +
    "widens the set. An id that names no document is the server's `404`, which is exit 5, and " +
    "a document nothing relates to is a single honest line and exit 0.",
  args: [{ name: "id", required: true, description: "The document to expand from." }],
  flags: [
    {
      name: "limit",
      type: "number",
      valueName: "n",
      description:
        `How many related documents to return, 1–${String(RETRIEVAL_MAX_LIMIT)} (default ` +
        `${String(RETRIEVAL_DEFAULT_LIMIT)}) — the same frugal cap ranked search uses, for the ` +
        "same reason. There is no `--offset`.",
    },
    {
      // Declared here rather than taken from the shared filter flags, mirroring
      // the contract's own reasoning: the shared wording is written around
      // `--status`, which this verb does not take, so reusing it would document
      // a flag that is not on the command.
      name: "include-archived",
      type: "boolean",
      description:
        "Include archived neighbours as well. Archiving is organizational rather than deletion, " +
        "so an archived neighbour is still a real relation — just not what an agent expanding " +
        "from a live document usually wants first.",
    },
  ],
  examples: [
    {
      command: "corpus doc related doc_a1b2c3",
      description:
        "One padded line per neighbour — id, relation, excerpt — most related first. Read one with `corpus doc show <id>`.",
    },
    {
      command: "corpus doc related doc_a1b2c3 --limit 3 --include-archived",
      description:
        "The three closest neighbours, archived documents included — the sweep that follows a search hit.",
    },
    {
      command: "corpus doc related doc_a1b2c3 --json",
      description:
        'One JSON value: `{"related":[{"id":"th_x9y8","title":"Rate assumptions",' +
        '"excerpt":"Locking at 6.1% assumes the survey lands before June.","relation":"linked"}],' +
        '"semanticIndex":"current"}`.',
    },
  ],
  handler: (context) => runDocRelated(context),
};
