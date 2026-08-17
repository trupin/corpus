import {
  bodyFlags,
  parseTriStateBoolean,
  requireFlag,
  resolveBody,
  splitTags,
  warningSuffix,
  type InputDependencies,
  JOB_FLAG,
  resolveJob,
} from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { parseViewFlags, VIEW_KEY_FLAGS } from "./frontmatter.js";

/**
 * `corpus doc create` — the first half of the agent's stewardship surface
 * (SPEC.md §7): "creates, edits, moves, and archives documents on its own
 * initiative".
 *
 * The verb is deliberately thin. It parses flags, reads a body from one source,
 * and posts. It does not check that the folder exists, does not invent an id,
 * does not touch a file: the server assigns the id, pre-fills the body from the
 * type's template when none was given, files the document and commits it with
 * the acting party as git author.
 */

export async function runDocCreate(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies = {},
): Promise<void> {
  const type = requireFlag(context, "type", "type");
  const job = resolveJob(context.flags, context.env);
  const title = requireFlag(context, "title", "text");
  const body = await resolveBody(context, dependencies);
  const tags = splitTags(context.flags.string("tags"));
  const folder = context.flags.string("folder");
  const due = context.flags.string("due");
  const evergreen = parseTriStateBoolean("evergreen", context.flags.string("evergreen"));
  const view = parseViewFlags(context.flags);

  const response = await context.client.request((api) =>
    api.POST("/api/docs", {
      body: {
        type,
        title,
        // SPEC.md §9.2: the work this write serves, so the document records the
        // conversation it came from. Omitted when neither `--job` nor
        // `CORPUS_JOB` names one — a write with no job records no origin, and
        // that is a fact about the document rather than a missing field.
        ...(job === undefined ? {} : { job }),
        // Every optional field is *omitted* rather than sent as undefined: the
        // contract distinguishes "no body" (pre-fill from the template) from an
        // explicitly empty one.
        ...(body === undefined ? {} : { body }),
        ...(folder === undefined ? {} : { folder }),
        ...(tags === undefined ? {} : { tags }),
        ...(due === undefined ? {} : { due }),
        ...(evergreen === undefined ? {} : { evergreen }),
        ...view,
      },
    }),
  );

  context.out.emit(response);
  context.out.line(
    `created ${response.doc.frontmatter.id} — ${response.doc.path}${warningSuffix(response.warnings)}`,
  );
}

export const createCommand: WorkspaceCommandSpec = {
  name: "create",
  summary: "Create a document.",
  description:
    "A type and a title are the whole requirement (SPEC.md §11's zero-form creation); everything " +
    "else the server fills in, including the id, which is immutable thereafter. The body comes " +
    "from `-m`, from `--file`, or from stdin — the heredoc form the agent's skills use — and " +
    "omitting all three is legal: the server pre-fills from the type's `template` document when " +
    "one exists. Bytes are passed through untouched; there is no markdown processing in the CLI. " +
    "An omitted `--folder` files the document in `data/docs/inbox/` (creation is inbox-first); a " +
    "folder the server rejects is reported verbatim rather than pre-validated here. " +
    "`--pinned`, `--order`, `--query` and `--column` write the SPEC.md §11 **view keys** at " +
    "creation, so `--type view --pinned true` is a board column in one command — the board picks " +
    "it up over SSE with no reload. A column the board's own “＋ New list” would have written " +
    "also carries `--folder views --evergreen true`, which is what the seed columns look like " +
    "and what keeps a column out of the staleness ramp (SPEC.md §5); the flags are explicit " +
    "rather than implied by `--type view`, because this verb defaults nothing per type. Prints " +
    "the new id and path; `--json` emits the server's `{doc, warnings}` response unchanged.",
  args: [],
  flags: [
    {
      name: "type",
      type: "string",
      valueName: "type",
      description:
        "Document type: `note`, `view`, `template`, `skill`, `agent-def`, or a plugin's own. Required.",
    },
    {
      name: "title",
      type: "string",
      valueName: "text",
      description: "The document's title. Required.",
    },
    {
      name: "folder",
      type: "string",
      valueName: "path",
      description:
        "Folder under `data/docs/`, as a bare name (`finance`) or the full prefix " +
        "(`data/docs/finance`). Defaults to `inbox`.",
    },
    {
      name: "tags",
      type: "string",
      valueName: "a,b",
      description: "Comma-separated tags. Blank entries are dropped; defaults to no tags.",
    },
    {
      name: "due",
      type: "string",
      valueName: "yyyy-mm-dd",
      description: "Optional deadline, surfaced in Attention and in filters.",
    },
    {
      name: "evergreen",
      type: "string",
      valueName: "true|false",
      description:
        "Opt the document out of staleness from the start. Defaults to `false`; a board column " +
        "is created with `true`, because a column is configuration rather than content and a " +
        "six-month-old Inbox column is not something to review.",
    },
    ...VIEW_KEY_FLAGS,
    ...bodyFlags("The document body"),
    JOB_FLAG,
  ],
  examples: [
    {
      command: 'corpus doc create --type note --title "Mortgage options" --folder finance',
      description:
        "Create a note in `data/docs/finance/`, with the body pre-filled from the `note` template.",
    },
    {
      command:
        "corpus doc create --type note --title \"Mortgage options\" --tags finance,housing --from agent <<'EOF'\n30-year fixed at 6.1%.\nEOF",
      description:
        "The agent's form: body from a heredoc, tagged, and committed with `agent` as the git author.",
    },
    {
      command:
        'corpus doc create --type view --title "Unresolved finance" --folder views --evergreen true --pinned true --order 4 --query type=thread --query status=open --query tag=finance --from agent',
      description:
        "SPEC.md §11's “pin me a view of unresolved finance threads”, in one command: the view document lands in `data/docs/views/`, the board grows a fourth column live over SSE, and `git log` records the agent as its author.",
    },
    {
      command:
        'corpus doc create --type view --title "Todos" --folder views --evergreen true --pinned true --order 5 --column todos/todos',
      description:
        "A plugin column: the same pinned view document, rendered by the plugin's own column type (SPEC.md §10). An uninstalled plugin keeps the position and shows the plugin-missing card.",
    },
    {
      command: 'corpus doc create --type note --title "Notes" --file notes.md --json',
      description:
        'Body from a file; one JSON value — `{"doc":{…},"warnings":[]}` — for a caller that needs the id.',
    },
  ],
  handler: (context) => runDocCreate(context),
};
