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
    "A type and a title are the whole requirement (SPEC.md §10's zero-form creation); everything " +
    "else the server fills in, including the id, which is immutable thereafter. The body comes " +
    "from `-m`, from `--file`, or from stdin — the heredoc form the agent's skills use — and " +
    "omitting all three is legal: the server pre-fills from the type's `template` document when " +
    "one exists. Bytes are passed through untouched; there is no markdown processing in the CLI. " +
    "An omitted `--folder` files the document in the root its `--type` declares: `data/docs/inbox/` " +
    "for every ordinary type (creation is inbox-first), and `.claude/agents/` for `--type " +
    "agent-def`, which SPEC.md §7 gives its own document root — so a persona takes no extra flag. " +
    "**An explicit `--folder` wins over that default**, which is what keeps a document _about_ a " +
    "persona expressible: `--type agent-def --folder inbox` still files under `data/docs/`. " +
    "**What that costs is addressability, and it costs all of it**: a persona is loaded and " +
    "resolved from `.claude/agents/` alone, so an `agent-def` written anywhere else answers to " +
    "neither `@<name>` nor `corpus thread designate --agent`, under its filename stem or its " +
    "title alike — it is a note about a persona rather than one. A root " +
    "of its own may also be named outright, by its exact declared path (`--folder .claude/agents`) " +
    "and never a folder beneath it; a root named that way must hold the type asked for, so `--type " +
    "note --folder .claude/agents` is a `400` rather than a note the corpus would index as a " +
    "persona. **`--type thread` is placed by neither rule**: a thread is flat at " +
    "`data/threads/<id>.md`, named by its id (SPEC.md §4), so an omitted `--folder` is not the " +
    "inbox and an explicit one is still checked but never changes where it lands — and a thread is " +
    "normally created by `corpus thread create`. `--type skill` is the one type whose own root is " +
    "out of reach here: `.claude/skills` indexes `SKILL.md` files alone, as does the archived root " +
    "beside it, so naming either as a `--folder` is a `400` and a skill created with no `--folder` " +
    "lands in the inbox like anything else — `corpus skill create` owns genesis at " +
    "`<name>/SKILL.md`, while `--type skill --folder finance` files an ordinary document in " +
    "`data/docs/finance/`. A folder the server rejects is reported verbatim rather than " +
    "pre-validated here. " +
    "`--pinned`, `--order` and `--query` write the SPEC.md §10 **view keys** at " +
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
        "Document type: `note`, `view`, `template`, `skill`, `agent-def`, or any other value this workspace uses (SPEC.md §5 — the field is an open string). Required.",
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
        "(`data/docs/finance`); a type SPEC.md §7 gives its own document root may instead name " +
        "that root by its exact declared path (`.claude/agents`). Defaults to the root `--type` " +
        "declares — `inbox` for ordinary types, `.claude/agents` for `agent-def` — and an " +
        "explicit folder wins over that default. **`--type thread` is the exception at both " +
        "ends**: a thread is placed flat at `data/threads/<id>.md` before this flag is consulted " +
        "(SPEC.md §4), so a folder sent with one is validated and then has no effect.",
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
        "corpus doc create --type agent-def --title \"Analyst\" --from agent <<'CORPUS_EOF'\nYou read the corpus and answer with evidence.\nCORPUS_EOF",
      description:
        "A persona, in one command: no `--folder`, because `agent-def` has its own document root — one copy of the file, read by Claude Code and by Corpus, with no sync (SPEC.md §7). It lands at `.claude/agents/analyst.md`, `@analyst` resolves to it in the very next comment (SPEC.md §8), and Claude Code lists it as a subagent, because the server writes both discovery keys with the document: `name`, derived from the filename, and `description`, defaulted to the title (SERVER-123). That default is thin on purpose — `corpus doc edit <id> --extra description=…` is how it comes to say _when_ to reach for this one.",
    },
    {
      command:
        "corpus doc create --type note --title \"Mortgage options\" --tags finance,housing --from agent <<'CORPUS_EOF'\n30-year fixed at 6.1%.\nCORPUS_EOF",
      description:
        "The agent's form: body from a heredoc, tagged, and committed with `agent` as the git author.",
    },
    {
      command:
        'corpus doc create --type view --title "Unresolved finance" --folder views --evergreen true --pinned true --order 4 --query type=thread --query status=open --query tag=finance --from agent',
      description:
        "SPEC.md §10's “pin me a view of unresolved finance threads”, in one command: the view document lands in `data/docs/views/`, the board grows a fourth column live over SSE, and `git log` records the agent as its author.",
    },
    {
      command: 'corpus doc create --type note --title "Notes" --file notes.md --json',
      description:
        'Body from a file; one JSON value — `{"doc":{…},"warnings":[]}` — for a caller that needs the id.',
    },
  ],
  handler: (context) => runDocCreate(context),
};
