import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { reportFolderAct } from "./report.js";

/**
 * `corpus folder archive` and `corpus folder unarchive` — the two directions of
 * one act (SPEC.md §9.2, rider 7), so they are one function and two
 * declarations.
 *
 * **Neither moves anything.** Archiving a folder is a status act: the folder
 * stays where it is and every path is unchanged, which is exactly what makes it
 * reversible by its inverse rather than by remembering where things were. The
 * one exception belongs to the document verb, not this one — `corpus doc
 * archive` on a `type: skill` document also moves its folder — and a skill is
 * therefore archived by document, never by folder, which is why a dot-leading
 * path like `.claude/skills/x` is refused by the path grammar.
 *
 * **The result lists every document under the folder, not every document that
 * changed.** A document already archived is left alone and is still listed,
 * because the act applied to it. Read the rows as "the state after the act".
 */

interface Direction {
  readonly route: "/api/folders/archive" | "/api/folders/unarchive";
  readonly verb: string;
}

async function runFolderStatusAct(
  context: WorkspaceCommandContext,
  direction: Direction,
): Promise<void> {
  const path = context.args.get("path");

  const result = await context.client.request((api) =>
    api.POST(direction.route, { body: { path } }),
  );

  context.out.emit(result);
  reportFolderAct(context, {
    rows: result.documents.map((document) => [document.id, document.status]),
    summary: `${direction.verb} ${path}`,
    warnings: result.warnings,
  });
}

export const runFolderArchive = (context: WorkspaceCommandContext): Promise<void> =>
  runFolderStatusAct(context, { route: "/api/folders/archive", verb: "archived" });

export const runFolderUnarchive = (context: WorkspaceCommandContext): Promise<void> =>
  runFolderStatusAct(context, { route: "/api/folders/unarchive", verb: "restored" });

const PATH_ARG = {
  name: "path",
  required: true as const,
  description:
    "The folder, relative to `data/docs/` — `finance`, `finance/mortgage`. Compared exactly: no " +
    "`data/docs/` prefix, no trailing slash, no case folding.",
};

export const archiveCommand: WorkspaceCommandSpec = {
  name: "archive",
  summary: "Archive every document in a folder (reversible; never a deletion).",
  description:
    "Flips `status` to `archived` on every document and thread under `data/docs/<path>`, " +
    "recursively (SPEC.md §9.2, rider 7). **It moves nothing**: archiving a folder is a status " +
    "act, not a relocation, so the folder stays where it is and every path is unchanged — which " +
    "is what makes it reversible by `corpus folder unarchive` rather than by remembering where " +
    "things were. Nothing leaves git and nothing leaves the index; the documents simply drop out " +
    "of the default `GET /api/docs` result set. This is the verb the agent uses where a person " +
    "would reach for delete.\n\n" +
    "**Every document under the folder is listed, including ones that were already archived** — " +
    "the act applied to them, and the rows report the status each document _has_ rather than " +
    "the ones that changed. `404` when the folder is unknown. One act, one commit (§4), " +
    "authored by `--from`. A `type: skill` document is archived by `corpus doc archive`, not " +
    "here: its folder has to move with its status, and `.claude/` is outside this path grammar.",
  args: [PATH_ARG],
  flags: [],
  examples: [
    {
      command: "corpus folder archive finance/2024",
      description:
        "Retire a whole folder, keeping every file and every version of it in git. One line per document with its status, then the count.",
    },
    {
      command: "corpus folder archive finance/2024 --from agent --json",
      description:
        'One JSON value — `{"documents":[{"id":"doc_a1b2c3","status":"archived"}],"warnings":[]}` — with the act attributed to the agent.',
    },
  ],
  handler: (context) => runFolderArchive(context),
};

export const unarchiveCommand: WorkspaceCommandSpec = {
  name: "unarchive",
  summary: "Restore every archived document in a folder.",
  description:
    "The inverse flip, back to `status: resolved` — the state archiving already implied (SPEC.md " +
    "§5) — on every document and thread under `data/docs/<path>`. It moves nothing, for the " +
    "reason archiving moves nothing. A document that was **not** archived is left exactly as it " +
    "is and is still listed, because the act applied to it: the rows report the status each " +
    "document has after the act, not the ones that changed. `404` when the folder is unknown. " +
    "One act, one commit (§4), authored by `--from`.",
  args: [PATH_ARG],
  flags: [],
  examples: [
    {
      command: "corpus folder unarchive finance/2024",
      description: "Bring a whole folder back; each document lands on `resolved`, not on `open`.",
    },
    {
      command: "corpus folder unarchive finance/2024 --json",
      description:
        'One JSON value — `{"documents":[{"id":"doc_a1b2c3","status":"resolved"}],"warnings":[]}`.',
    },
  ],
  handler: (context) => runFolderUnarchive(context),
};
