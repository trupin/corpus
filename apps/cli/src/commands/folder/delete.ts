import { DOCS_FOLDER_ROOT, MAX_PAGE_LIMIT, type DocRow } from "@corpus/contract";
import { UsageError } from "../../errors.js";
import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { renderColumns } from "../columns.js";
import { reportFolderAct } from "./report.js";

/**
 * `corpus folder delete` — the folder act that is **user-only**, and the one
 * this CLI guards on its own (SPEC.md §9.2, rider 7; §7).
 *
 * Two guards, for two different callers.
 *
 * **The agent is refused before anything is sent.** The server rejects
 * `x-corpus-author: agent` with a `403` and that backstop stays where it is;
 * refusing here is what lets the message say *the agent archives, never deletes*
 * and name the verb that does it, in the agent's own vocabulary rather than as a
 * status code.
 *
 * **`--yes` is this CLI's guard, and the server has none.** §10 puts the
 * confirmation in the UI, so a folder delete arriving over HTTP is already
 * confirmed as far as the server is concerned. Without `--yes` this verb lists
 * what it would remove and exits 2, having sent no delete: a list you can read
 * is a better confirmation than a prompt, and — unlike `corpus doc delete`'s
 * prompt — it works identically for a person at a terminal and for an agent that
 * has no terminal at all. There is deliberately no interactive fallback: a piped
 * stdin must never be mistaken for a yes (CLI-003), and the list plus a re-run is
 * a shorter path than a prompt nobody can answer.
 *
 * ## What the preview asks for, and why it filters
 *
 * There is no dry-run route, so the preview is the ordinary collection query.
 * Two corrections are applied to it, both because the delete's own rule is
 * narrower than the filter's:
 *
 * - `GET /api/docs?folder=` includes **threads**, which inherit their parent's
 *   folder (§6) — and a folder delete does not remove them. They survive as
 *   orphaned records still naming a deleted parent, and the delete's own
 *   response never names them. So the preview keeps only rows whose `path` is
 *   actually under `data/docs/<path>/`, which is exactly the set the server
 *   deletes, and never promises to remove a conversation it will leave standing.
 * - The filter's prefix match folds ASCII case in SQLite, while the act compares
 *   byte-exactly. The same `path` filter fixes that too, so the preview cannot
 *   list a `FINANCE` document under a delete of `finance`.
 *
 * It pages to the end rather than showing the first page: a confirmation that
 * silently stopped at 50 rows would be a confirmation of the wrong thing.
 */

export const AGENT_REFUSAL = "deleting a folder is user-only — the agent archives, never deletes";

export async function runFolderDelete(context: WorkspaceCommandContext): Promise<void> {
  const path = context.args.get("path");

  if (context.actor !== "user") {
    throw new UsageError(AGENT_REFUSAL, {
      hint: `Archive it instead: \`corpus folder archive ${path}\`. Nothing was sent to the server.`,
    });
  }

  if (!context.flags.boolean("yes")) {
    await refuseWithPreview(context, path);
  }

  const result = await context.client.request((api) =>
    api.POST("/api/folders/delete", { body: { path } }),
  );

  context.out.emit(result);
  reportFolderAct(context, {
    rows: result.documents.map((document) => [document.id]),
    summary: `deleted ${path}`,
    warnings: result.warnings,
  });
}

/** Always throws: it exists to make the refusal carry the list. */
async function refuseWithPreview(context: WorkspaceCommandContext, path: string): Promise<never> {
  const documents = await documentsUnder(context, path);
  const rows = documents.map((document) => [document.id, document.type, document.path]);

  throw new UsageError(
    `refusing to delete ${DOCS_FOLDER_ROOT}/${path} without --yes — ${
      documents.length === 0 ? "it holds no documents" : plural(documents.length, "document")
    }.`,
    {
      hint:
        "Deleting is irreversible in the working tree (git keeps every version). Re-run with " +
        `--yes, or archive instead: \`corpus folder archive ${path}\`. Threads on these ` +
        "documents are **not** deleted — they survive as orphaned records still naming a " +
        "deleted parent — and are not listed here.",
      details: { documents },
      detailLines: renderColumns(rows).map((line) => `  ${line}`),
    },
  );
}

/**
 * Every document the delete would remove: those whose **path** is under
 * `data/docs/<folder>/`, which is the server's own rule for what a folder holds.
 * Paged to the end, because a partial list is a misleading confirmation.
 */
async function documentsUnder(
  context: WorkspaceCommandContext,
  folder: string,
): Promise<readonly DocRow[]> {
  const prefix = `${DOCS_FOLDER_ROOT}/${folder}/`;
  const found: DocRow[] = [];

  for (let offset = 0; ;) {
    const page = await context.client.request((api) =>
      api.GET("/api/docs", {
        params: {
          query: { folder, includeArchived: true, limit: MAX_PAGE_LIMIT, offset },
        },
      }),
    );

    found.push(...page.items.filter((item) => item.path.startsWith(prefix)));

    offset += page.items.length;
    // `items.length === 0` also ends it, and has to: a total that shrank between
    // two pages would otherwise loop forever against a moving corpus.
    if (page.items.length === 0 || offset >= page.page.total) return found;
  }
}

export const deleteCommand: WorkspaceCommandSpec = {
  name: "delete",
  summary:
    "Delete a folder and every document in it (user-only, irreversible in the working tree).",
  description:
    "**The agent may not run this.** `--from agent` (or `CORPUS_FROM=agent`) is refused here, " +
    "before any request is sent, with exit 2: the agent archives, never deletes (SPEC.md §7). " +
    "The server rejects it with a `403` as well; this guard exists so the agent gets the reason " +
    "rather than a status code.\n\n" +
    "**Without `--yes` it deletes nothing.** It lists what it would remove — one line per " +
    "document, id, type and path — and exits 2. That is this CLI's own guard: the confirmation " +
    "§10 describes lives in the UI, so a request arriving over HTTP is already confirmed as far " +
    "as the server is concerned. There is no prompt in either direction, so the same command " +
    "behaves identically with and without a terminal, and a piped body can never be mistaken " +
    "for a yes.\n\n" +
    "**Threads are not deleted.** A thread on a deleted document survives as an **orphaned " +
    "record** — still readable, still naming this document as `parent`, with anchors that no " +
    "longer resolve — exactly as `corpus doc delete` leaves them, and the preview does not list " +
    "them for that reason. Nothing is removed from git history. The folder itself goes when the " +
    "deletions leave it empty; anything in it that was never a document — an image, a stray " +
    "`.csv` — is left alone, and so is the folder holding it. `404` when the folder is unknown.",
  args: [
    {
      name: "path",
      required: true,
      description:
        "The folder, relative to `data/docs/` — `finance`, `finance/2024`. Compared exactly: no " +
        "`data/docs/` prefix, no trailing slash, no case folding.",
    },
  ],
  flags: [
    {
      name: "yes",
      type: "boolean",
      description:
        "Actually delete. Without it the command lists what it would remove and exits 2, having " +
        "sent nothing.",
    },
  ],
  examples: [
    {
      command: "corpus folder delete finance/2024",
      description:
        "The safe half: prints every document the delete would remove, deletes none of them, and exits 2.",
    },
    {
      command: "corpus folder delete finance/2024 --yes",
      description:
        "Delete it. One line per removed id, then the count; git retains every version of every file.",
    },
    {
      command: "corpus folder delete finance/2024 --yes --json",
      description: 'One JSON value — `{"documents":[{"id":"doc_a1b2c3"}],"warnings":[]}`.',
    },
  ],
  handler: (context) => runFolderDelete(context),
};
