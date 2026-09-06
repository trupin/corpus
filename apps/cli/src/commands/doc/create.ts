import {
  bodyFlags,
  BODY_SOURCES_HELP,
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
import { parseBoardFlags, BOARD_KEY_FLAGS } from "./frontmatter.js";
import { effectLines, keyLine, otherWarnings } from "./render.js";

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
 *
 * **Which root a document lands in is the server's answer, not this verb's**
 * (SERVER-122). An omitted `folder` files the document in the root its `type`
 * declares — `data/docs/inbox/` for ordinary types, `.claude/agents/` for
 * `agent-def` — and an explicit `folder` wins over that default. Both doors are
 * one rule reading the server's own root declaration, so a root added later is
 * creatable with no edit here. **`type: thread` obeys neither**: `allocatePath`
 * (`apps/server/src/docs/create.ts`) places it flat at `data/threads/<id>.md`
 * before `folder` is consulted at all, so a folder sent with one is validated
 * and then has no effect. This verb sends `type` and `folder` as typed and
 * renders the path that comes back; it pre-validates neither, and it must never
 * construct one (architecture decision 2).
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
  const board = parseBoardFlags(context.flags);

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
        ...board,
      },
    }),
  );

  context.out.emit(response);
  context.out.line(
    `created ${response.doc.frontmatter.id} — ${response.doc.path}${warningSuffix(otherWarnings(response.warnings))}`,
  );
  // The key, on the line after the confirmation, exactly as every write that
  // lands prints one (CLI-047). A create is a write, and its caller is the one
  // party that unambiguously knows the bytes.
  //
  // The argument against was that printing a key invites holding one across an
  // interval in which anything may have changed — the habit the key contract
  // exists to break. It loses on the contract's own terms: a key the document
  // has moved past is **refused**, so this can save a read when nothing
  // intervened and can never cause a wrong write when something did. The
  // refusal is the mechanism working, and its recovery is the read the caller
  // would otherwise have made unconditionally.
  context.out.line(keyLine(response.doc));
  for (const line of effectLines(response.warnings)) context.out.line(line);
}

export const createCommand: WorkspaceCommandSpec = {
  name: "create",
  summary: "Create a document.",
  description:
    "A type and a title are the whole requirement (SPEC.md §10's zero-form creation); " +
    "everything else the server fills in, including the id, immutable thereafter. Omitting " +
    "every body source is legal: the server pre-fills from the type's `template` document when " +
    "one exists. Bytes are passed through untouched — no markdown processing in the CLI.\n\n" +
    "An omitted `--folder` files the document in the root its `--type` declares: " +
    "`data/docs/inbox/` for ordinary types, `.claude/agents/` for `agent-def`. An explicit " +
    "`--folder` wins over that default, but **an `agent-def` outside `.claude/agents/` answers " +
    "to neither `@<name>` nor `corpus thread designate --agent`** — it is a note about a " +
    "persona rather than one. A declared root may be named outright by its exact path " +
    "(`--folder .claude/agents`), and must hold the type asked for. `--type skill` cannot " +
    "reach its own root here — `corpus skill create` owns genesis at `<name>/SKILL.md` — and " +
    "with no `--folder` lands in the inbox.\n\n" +
    "The six board flags write SPEC.md §10's **board and view keys** at creation, so `--type " +
    "board --columns a,b` is a whole board in one command and `--kanban '…'` a whole kanban — " +
    "the board bar picks either up over SSE. A `type: view` document is a saved query and " +
    "nothing more; a board's `--columns` is what puts it on a board. This verb defaults " +
    "nothing per type. Prints the new id and path, then the **key** for the bytes it wrote (a " +
    "create-then-edit needs no read in between), and any second effect on its own line. " +
    "`--json` emits the server's `{doc, warnings}` unchanged.\n\n" +
    BODY_SOURCES_HELP,
  args: [],
  flags: [
    {
      name: "type",
      type: "string",
      valueName: "type",
      description:
        "Document type: `note`, `view`, `board`, `template`, `skill`, `agent-def`, or any " +
        "other value this workspace uses (SPEC.md §5 — an open string). Required.",
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
        "(`data/docs/finance`); a type with a root of its own may name it by exact path " +
        "(SPEC.md §7). **`--type thread` is the exception at both ends**: a thread is placed " +
        "flat at `data/threads/<id>.md` before this flag is consulted (SPEC.md §4), so a " +
        "folder sent with one is validated and then has no effect.",
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
      valueName: "bool",
      description:
        "Opt the document out of staleness from the start. Defaults to `false`; a board " +
        "column is created with `true`, configuration not being content.",
    },
    ...BOARD_KEY_FLAGS,
    ...bodyFlags("The document body"),
    JOB_FLAG,
  ],
  examples: [
    {
      command:
        "corpus doc create --type note --title \"Mortgage options\" --tags finance,housing --from agent <<'CORPUS_EOF'\n30-year fixed at 6.1%.\nCORPUS_EOF",
      description:
        "The agent's form: body from a heredoc, tagged, and committed with `agent` as the git author.",
    },
    {
      command:
        "corpus doc create --type agent-def --title \"Analyst\" --from agent <<'CORPUS_EOF'\nYou read the corpus and answer with evidence.\nCORPUS_EOF",
      description:
        "A persona, in one command: no `--folder`, because `agent-def` has its own root (SPEC.md §7). It lands at `.claude/agents/analyst.md`, `@analyst` resolves to it, and Claude Code lists it as a subagent — the server writes both discovery keys: `name`, derived from the filename, and `description`, defaulted to the title (SERVER-123).",
    },
    {
      command:
        'corpus doc create --type view --title "Unresolved finance" --folder views --evergreen true --query type=thread --query status=open --query tag=finance --from agent',
      description: "A saved query, put on a board by that board's `--columns`.",
    },
    {
      command:
        'corpus doc create --type board --title "Attention" --folder views --evergreen true --columns doc_v1e2w3,doc_v4e5w6 --order 1 --default-open true --from agent',
      description: "A whole board in one command (rider 2).",
    },
    {
      command:
        'corpus doc create --type board --title "Triage" --folder views --evergreen true --kanban \'{"field":"stage","stages":["triage","doing","done"],"status":{"done":"resolved"}}\' --query type=note --from agent',
      description:
        "A kanban (rider 6): one derived column per stage, drawn from the `--query` scope.",
    },
  ],
  handler: (context) => runDocCreate(context),
};
