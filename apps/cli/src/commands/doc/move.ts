import { requireFlag, warningSuffix, JOB_FLAG, resolveJob } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus doc move` — relocation, and nothing else (SPEC.md §9.2). The id never
 * changes, so every `[[ref]]`, anchor entry and thread `parent` keeps resolving;
 * only the path moves.
 *
 * The document is read before the move so the outcome can be reported honestly:
 * the server no-ops a move to the folder the document is already in — it writes
 * nothing and commits nothing — but its response looks identical either way.
 * Comparing the path before and after is what turns that into "already in
 * finance" rather than a "moved" line that did not move anything.
 */

export async function runDocMove(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");
  const folder = requireFlag(context, "folder", "path");
  const job = resolveJob(context.flags, context.env);

  const before = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id } } }),
  );
  const response = await context.client.request((api) =>
    api.POST("/api/docs/{id}/move", {
      params: { path: { id } },
      // SPEC.md §9.2: attribution only — a move creates no document, so it
      // records no origin, but an unresolvable job is still refused (422).
      body: { folder, ...(job === undefined ? {} : { job }) },
    }),
  );

  context.out.emit(response);
  const suffix = warningSuffix(response.warnings);
  if (response.doc.path === before.path) {
    context.out.line(`${id} is already at ${before.path}${suffix}`);
    return;
  }
  context.out.line(`moved ${id} — ${response.doc.path}${suffix}`);
}

export const moveCommand: WorkspaceCommandSpec = {
  name: "move",
  summary: "Move a document to another folder.",
  description:
    "Rewrites the file's path and nothing else: **the id never changes**, so no reference, anchor " +
    "or thread parent has to be rewritten (SPEC.md §9.2). Moving a document to the folder it is " +
    "already in is a reported no-op that writes and commits nothing — the agent's loop never has " +
    "to branch on it.\n\n" +
    "**Only a document under `data/docs/` can be moved**, and that is the whole rule — stated " +
    "rather than enumerated, because the list is what went stale twice (CLI-052). Anything " +
    "filed anywhere else has a fixed location: a thread under `data/threads/`, a skill under " +
    "`.claude/skills/`, a persona under `.claude/agents/`. The server refuses all of them with " +
    "`this document's location is fixed`, in **two** wordings that differ by type — a thread is " +
    "`threads are flat under data/threads/ and cannot be moved`, and everything else off the " +
    "docs root is `<path> is not under data/docs/ and cannot be moved`, which names the path so " +
    "the reason is legible. Repair such a document where it is (`corpus doc check`) rather than " +
    "moving it by hand: off the docs root a file often carries no `id:` of its own, so relocating " +
    "it re-mints the id and breaks every `[[ref]]`, anchor and thread pointing at it.\n\n" +
    "A move **names its own delta** and needs no " +
    "key (SPEC.md §7) — and because a key names the document's content rather than its path, a " +
    "key read before a move is still good after it.",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [
    {
      name: "folder",
      type: "string",
      valueName: "path",
      description:
        "Destination folder under `data/docs/`, as a bare name (`finance`) or the full prefix " +
        "(`data/docs/finance`). Required.",
    },
    JOB_FLAG,
  ],
  examples: [
    {
      command: "corpus doc move doc_a1b2c3 --folder finance",
      description: "File an inbox arrival under `data/docs/finance/`.",
    },
    {
      command: "corpus doc move doc_a1b2c3 --folder archive-notes --json",
      description:
        'One JSON value — `{"doc":{…},"warnings":[]}` — carrying the document at its new path.',
    },
  ],
  handler: (context) => runDocMove(context),
};
