import { requireFlag, warningSuffix } from "../../input.js";
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

  const before = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id } } }),
  );
  const response = await context.client.request((api) =>
    api.POST("/api/docs/{id}/move", { params: { path: { id } }, body: { folder } }),
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
    "to branch on it. Threads live flat under `data/threads/` and skills inside their own folder, " +
    "so neither can be moved; the server says so. A `423` from the other party's edit lock is a " +
    "server error (exit 5).",
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
