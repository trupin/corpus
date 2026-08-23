import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { reportFolderAct } from "./report.js";

/**
 * `corpus folder rename` — move a folder, and every document and thread under
 * it, in one act (SPEC.md §9.2, rider 7 signed 2026-08-22).
 *
 * **Ids never change.** The path is presentation and the id is identity (§5), so
 * every `[[ref]]`, anchor entry and thread `parent` keeps resolving across a
 * rename, and the response lists each document's new path rather than a new id.
 * That is why this verb prints paths: they are the only thing that moved.
 *
 * **The paths go byte-exactly as typed.** The server compares them that way — a
 * rename differing only in case is a rename, and `FINANCE` is a `404` in a
 * workspace holding `finance` — so nothing here lower-cases, trims a trailing
 * slash or strips a `data/docs/` prefix. Fixing a caller's path silently would
 * move files they did not name.
 */

export async function runFolderRename(context: WorkspaceCommandContext): Promise<void> {
  const from = context.args.get("from");
  const to = context.args.get("to");

  const result = await context.client.request((api) =>
    api.POST("/api/folders/rename", { body: { from, to } }),
  );

  context.out.emit(result);
  reportFolderAct(context, {
    rows: result.documents.map((document) => [document.id, document.path]),
    summary: `renamed ${from} → ${to}`,
    warnings: result.warnings,
  });
}

export const renameCommand: WorkspaceCommandSpec = {
  name: "rename",
  summary: "Rename or move a folder, and every document in it.",
  description:
    "Moves `data/docs/<from>` to `data/docs/<to>`, carrying every document and thread under it " +
    "(SPEC.md §9.2). **Ids never change** — the path is presentation and the id is identity " +
    "(§5) — so every `[[ref]]`, anchor entry and thread `parent` keeps resolving, and the " +
    "output lists each document at its **new path** rather than at a new id. A thread is listed " +
    "at its unchanged `data/threads/<id>.md`: what moved is the folder the thread belongs to " +
    "through its parent (§6), never the file. It lands as the single auto-commit §4 requires, " +
    "authored by `--from`.\n\n" +
    "Both paths are **relative to `data/docs/`** and are compared **exactly**: no leading or " +
    "trailing slash, no `data/docs/` prefix, no segment beginning with a dot, and no case " +
    "folding — `FINANCE` is a `404` in a workspace holding `finance`. A rename that differs only " +
    "in case is a rename. `409` when `to` already exists, because a rename never merges two " +
    "folders; `400` when a path is malformed or `to` is inside `from`; `404` when `from` names " +
    "no folder. Nothing is normalised here — a path this verb corrected on the caller's behalf " +
    "would move files they did not name.",
  args: [
    {
      name: "from",
      required: true,
      description:
        "The folder to rename, relative to `data/docs/` — `finance`, `finance/mortgage`.",
    },
    {
      name: "to",
      required: true,
      description: "Its new path, relative to `data/docs/`. It may not be inside `from`.",
    },
  ],
  flags: [],
  examples: [
    {
      command: "corpus folder rename inbox triage",
      description:
        "Move the whole folder: one line per document at its new path, one per thread at its unchanged `data/threads/` path, then the count.",
    },
    {
      command: "corpus folder rename finance archive/finance --from agent",
      description:
        "Nest a folder under another, attributed to the agent in `git log`. A rename creates the intermediate folders it needs and refuses to land on a folder that already exists.",
    },
    {
      command: "corpus folder rename inbox triage --json",
      description:
        'One JSON value — `{"documents":[{"id":"doc_a1b2c3","path":"data/docs/triage/notes.md"}],"warnings":[]}`.',
    },
  ],
  handler: (context) => runFolderRename(context),
};
