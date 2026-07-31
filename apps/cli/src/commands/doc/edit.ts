import {
  DOC_STATUSES,
  type AnchorReconciliation,
  type Doc,
  type DocStatus,
} from "@corpus/contract";
import { UsageError } from "../../errors.js";
import {
  bodyFlags,
  parseTriStateBoolean,
  plural,
  resolveBody,
  warningSuffix,
  type InputDependencies,
} from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import {
  combineExtraPatches,
  parseExtraFlags,
  parseExtraJsonFlags,
  parseViewFlags,
  VIEW_KEY_FLAGS,
} from "./frontmatter.js";

/**
 * The value grammar and the `--extra` parser moved to `./frontmatter.js` when
 * `doc create` grew the same flags (CLI-018); they are re-exported because this
 * verb is where they are documented and where their tests live.
 */
export { parseExtraFlags, parseExtraValue } from "./frontmatter.js";

/**
 * `corpus doc edit` — the save path, and the one place anchor reconciliation is
 * guaranteed to run (SPEC.md §6). The CLI's whole contribution is assembling the
 * patch: the server holds the lock, reconciles the anchors against the body as
 * it exists on disk, writes and commits.
 *
 * Two details matter for the agent's loop:
 *
 * - **A frontmatter-only edit sends no `body` key.** An empty body would be an
 *   instruction to wipe the document, so "no body source" and "an empty body"
 *   must stay distinguishable all the way to the wire.
 * - **The reconciliation report is rendered, not swallowed.** A detached thread
 *   is something the agent has to notice, so it is on the success line and, under
 *   `--json`, exactly as the server sent it.
 */

/** ISO instants are written to seconds, matching what the server stamps into frontmatter. */
export function instantNow(now: () => number = Date.now): string {
  return new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface EditDependencies extends InputDependencies {
  readonly now?: () => number;
}

/**
 * `--add-tag` / `--remove-tag` against a wire field that carries the whole list:
 * the current tags have to be read first. Only these two flags and `--status`
 * cost a read — a plain body or title edit is exactly one request, which is what
 * keeps a lock conflict a single, un-retried failure.
 *
 * **This read-then-write is an accepted race, not an oversight** (CLI-008 item
 * 3). Two concurrent `--add-tag` calls can each `GET` the same list and each
 * `PUT` its own merge, and the second write wins with the first one's tag
 * missing. Nothing in the CLI can close that window today: `PUT /api/docs/{id}`
 * takes `ActorHeaderSchema` and nothing else — there is no `If-Match`, no ETag
 * and no version anywhere in `packages/contract` or `apps/server`, so there is
 * no conditional write to make this atomic. The only concurrency control the API
 * offers is the `423` document lock, which serialises an *editing session*, not
 * a one-shot tag edit, and taking a lock per `--add-tag` would make the cheap
 * verb expensive and give it a lock to leak.
 *
 * The exposure is small and bounded: the window is one round trip, both writers
 * are this single-user workspace's own, and every version is in git. Closing it
 * properly means a conditional-write primitive on the contract — a filed
 * CONTRACT issue, not something this verb should invent.
 */
export function mergeTags(
  current: readonly string[],
  added: readonly string[],
  removed: readonly string[],
): string[] {
  const dropped = new Set(removed);
  const kept = current.filter((tag) => !dropped.has(tag));
  const next = [...kept];
  for (const tag of added) {
    if (!dropped.has(tag) && !next.includes(tag)) next.push(tag);
  }
  return next;
}

/**
 * The one closed enum this verb carries. Validating it here costs nothing and
 * turns a typo into a usage error naming the three values, instead of a round
 * trip that comes back as a `400`. Open-ended values — `--folder`, `--due` — are
 * still passed through untouched for the server to judge.
 */
function parseStatus(value: string | undefined): DocStatus | undefined {
  if (value === undefined) return undefined;
  const status = DOC_STATUSES.find((candidate) => candidate === value);
  if (status === undefined) {
    throw new UsageError(`--status must be one of: ${DOC_STATUSES.join(", ")} — got "${value}".`);
  }
  return status;
}

/**
 * The document as it stands, read at most once per invocation.
 *
 * Two things need it and neither should pay for the other: `--add-tag` needs the
 * current list to merge against, and `--status` needs to know whether the
 * document is archived (see {@link assertNotArchived}). Naming both flags is one
 * `GET`, naming neither is none — which is what keeps the ordinary body or title
 * edit a single request, and therefore a lock conflict a single un-retried
 * failure.
 */
function currentDocument(context: WorkspaceCommandContext, id: string): () => Promise<Doc> {
  let pending: Promise<Doc> | undefined;
  return () => {
    pending ??= context.client.request((api) =>
      api.GET("/api/docs/{id}", { params: { path: { id } } }),
    );
    return pending;
  };
}

/**
 * **A `--status` that would move an archived document off `archived` is refused**
 * (CLI-017, sprint-017 Adjudication 13; the message made type-honest by the
 * wave-3 audit, FIX 15).
 *
 * Since SERVER-039 this guard is **no longer the enforcement** — `PUT
 * /api/docs/{id}` refuses the same write itself, for every type, because a rule
 * only a client enforces is not enforced (the UI's frontmatter form and any
 * `curl` walked straight past this function). What it still is, is the *better
 * error*: it costs no round trip and, crucially, it names a **command**. The
 * server's refusal can only name `POST /api/docs/{id}/unarchive`, and the agent
 * this CLI exists for has no way to issue an HTTP request — it reads error
 * messages as instructions and needs `corpus doc unarchive <id>`. Same
 * relationship as {@link assertWritableExtraKey} and the contract's
 * `ExtraFrontmatterSchema`.
 *
 * **The message is per type, because the consequence is.** For a `type: skill`
 * document archiving is two facts — the status *and* which side of
 * `.claude/skills-archived/` the folder is on — so `--status open` there leaves
 * a skill disabled, invisible to Claude Code and still holding its name. For
 * every other type archiving is the status alone, and the honest reason is
 * simply that un-archiving is its own operation and a `PUT` may not do it. The
 * single old message told every note a story about a folder that does not
 * exist.
 *
 * The read this needs is one `GET`, and it carries the same accepted staleness
 * as {@link mergeTags}: the document could be archived, or unarchived, between
 * the read and the `PUT`. There is no conditional write to close that with (see
 * `mergeTags` for why), so the exposure is the same bounded one — and here it
 * costs nothing either way, because the server re-checks under its own lock: a
 * document archived inside the window is refused there instead of here.
 */
function assertNotArchived(current: Doc, id: string, status: DocStatus): void {
  if (current.frontmatter.status !== "archived" || status === "archived") return;

  const isSkill = current.frontmatter.type === "skill";
  throw new UsageError(
    isSkill
      ? `${id} is an archived skill; \`--status ${status}\` would set the frontmatter without bringing the skill back.`
      : `${id} is archived; \`--status ${status}\` writes the frontmatter and nothing else, which is not how a document comes back.`,
    {
      hint: isSkill
        ? `Run \`corpus doc unarchive ${id}\` — it restores the status *and* moves the folder back out of \`.claude/skills-archived/\`, which re-enables the skill and frees its name.`
        : `Run \`corpus doc unarchive ${id}\` — the operation that un-archives a document. The server refuses this write too (SERVER-039); refusing it here is what lets the message name a command instead of a route.`,
    },
  );
}

export async function runDocEdit(
  context: WorkspaceCommandContext,
  dependencies: EditDependencies = {},
): Promise<void> {
  const id = context.args.get("id");

  // **Flags are parsed before stdin is touched.** Every check in this block is
  // pure — an unknown `--status`, a core key in `--extra`, a non-boolean
  // `--evergreen` — and each one ends the command. Draining the heredoc first
  // meant the caller's body was consumed and thrown away by a failure that
  // never needed to read it, which for an agent piping a long document is a
  // silently lost payload rather than a retryable usage error.
  const title = context.flags.string("title");
  const status = parseStatus(context.flags.string("status"));
  const due = context.flags.string("due");
  const reviewed = context.flags.boolean("reviewed");
  const evergreen = parseTriStateBoolean("evergreen", context.flags.string("evergreen"));
  const extra = combineExtraPatches(
    parseExtraFlags(context.flags.strings("extra")),
    parseExtraJsonFlags(context.flags.strings("extra-json")),
  );
  const view = parseViewFlags(context.flags);

  const body = await resolveBody(context, dependencies);
  const read = currentDocument(context, id);

  if (status !== undefined) assertNotArchived(await read(), id, status);

  const added = context.flags.strings("add-tag");
  const removed = context.flags.strings("remove-tag");
  const tags =
    added.length === 0 && removed.length === 0
      ? undefined
      : mergeTags((await read()).frontmatter.tags, added, removed);

  // Deliberately un-annotated: the generated request type uses exact optional
  // properties, so a `Partial`-shaped annotation (`title?: string | undefined`)
  // would not be assignable to it. The spread-of-conditionals form produces
  // exactly the shape the wire wants — a key is present or it is not.
  const patch = {
    ...(title === undefined ? {} : { title }),
    ...(status === undefined ? {} : { status }),
    ...(due === undefined ? {} : { due }),
    ...(reviewed ? { reviewed: instantNow(dependencies.now) } : {}),
    ...(evergreen === undefined ? {} : { evergreen }),
    ...(tags === undefined ? {} : { tags }),
    // Only the keys the caller named: `extra` is a merge patch, so sending the
    // whole object back would race every other writer of a key this invocation
    // never mentioned.
    ...(extra === undefined ? {} : { extra }),
    // The §11 view keys are *not* a merge patch — each is one core field, and
    // an unnamed one is simply absent here.
    ...view,
  };

  if (body === undefined && Object.keys(patch).length === 0) {
    throw new UsageError(`nothing to change on ${id}.`, {
      hint: "Pipe a body in, or name a field: --title, --add-tag, --remove-tag, --status, --due, --reviewed, --evergreen, --extra, --extra-json, --pinned, --order, --query, --column.",
    });
  }

  const response = await context.client.request((api) =>
    api.PUT("/api/docs/{id}", {
      params: { path: { id } },
      body: { ...patch, ...(body === undefined ? {} : { body }) },
    }),
  );

  context.out.emit(response);
  context.out.line(
    `edited ${id}${describeAnchors(response.anchors, response.doc)}${warningSuffix(response.warnings)}`,
  );
}

/** `— 1 anchor remapped, 1 orphaned (th_x9y8)`, or nothing at all when no anchor moved. */
export function describeAnchors(anchors: AnchorReconciliation, doc: Doc): string {
  if (anchors.remapped.length === 0 && anchors.orphaned.length === 0) return "";

  const parts: string[] = [];
  if (anchors.remapped.length > 0)
    parts.push(`${plural(anchors.remapped.length, "anchor")} remapped`);
  if (anchors.orphaned.length > 0) {
    // The anchor ids are what reconciliation reports; the *thread* ids are what
    // the agent has to go and look at, and the same response carries the map.
    const threads = anchors.orphaned.map(
      (anchorId) =>
        doc.anchors.find((anchor) => anchor.anchorId === anchorId)?.threadId ?? anchorId,
    );
    parts.push(`${String(anchors.orphaned.length)} orphaned (${threads.join(", ")})`);
  }
  return ` — ${parts.join(", ")}`;
}

export const editCommand: WorkspaceCommandSpec = {
  name: "edit",
  summary: "Edit a document's body and frontmatter.",
  description:
    "The body comes from `-m`, `--file` or stdin; naming none of them is a **frontmatter-only " +
    "edit** and the body is left exactly as it is — the CLI never sends an empty body it was not " +
    "given. Every save runs anchor reconciliation (SPEC.md §6) and the result is reported: " +
    "remapped anchors moved with the text, orphaned ones name the threads that just became " +
    "detached. `--reviewed` records the current instant as a “still current” confirmation, which " +
    "is deliberately not an edit (SPEC.md §5). `--add-tag`/`--remove-tag` read the document's " +
    "current tags first and `--status` reads the current document, so those flags cost one extra " +
    "request; nothing else does — and because the API " +
    "offers no conditional write, two tag edits racing on one document can end with only the " +
    "later one's tag, and the archived check below is read from the same one-round-trip-old " +
    "snapshot. **`--status` refuses to move an archived document off `archived`** and names " +
    "`corpus doc unarchive <id>` instead — for a `type: skill` document because the frontmatter " +
    "would say `open` while the folder stayed disabled in `.claude/skills-archived/` and its " +
    "name stayed blocked, and for every other type because un-archiving is its own operation. " +
    "The server refuses the same write (SERVER-039); refusing it here costs no round trip and " +
    "names a **command** where the server can only name a route. `--extra` and `--extra-json` " +
    "write non-core frontmatter keys — the " +
    "column `width` of SPEC.md §11 among them — as a merge patch: named keys replace, `null` " +
    "removes, unnamed keys are untouched. `--pinned`, `--order`, `--query` and `--column` write " +
    "the four **view keys** of SPEC.md §11, which are core fields rather than `extra` ones: a " +
    "board column IS a `type: view` document with `pinned: true`, so pinning, reordering and " +
    "reconfiguring one is this verb, and the board follows over SSE with no reload. A `423` from the " +
    "other party's edit lock is reported as a server error (exit 5) and is never retried — the " +
    "orchestrate skill defers instead. An edit that names no change at all is a usage error, not " +
    "an empty request.",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [
    { name: "title", type: "string", valueName: "text", description: "Replace the title." },
    {
      name: "add-tag",
      type: "string",
      valueName: "tag",
      repeated: true,
      description: "Add a tag, keeping the existing ones.",
    },
    {
      name: "remove-tag",
      type: "string",
      valueName: "tag",
      repeated: true,
      description: "Remove a tag. A tag both added and removed is removed.",
    },
    {
      name: "status",
      type: "string",
      valueName: "status",
      description:
        "Set the lifecycle status: `open`, `resolved` or `archived`. On an **archived " +
        "document** anything but `archived` is refused, naming `corpus doc unarchive <id>` — " +
        "the verb that un-archives, and for a `type: skill` document also moves the folder back " +
        "and frees the name, which frontmatter alone cannot do. Re-archiving an archived " +
        "document is still allowed.",
    },
    {
      name: "due",
      type: "string",
      valueName: "yyyy-mm-dd",
      description: "Set the deadline.",
    },
    {
      name: "reviewed",
      type: "boolean",
      description:
        'Record "still current" as of now. Staleness runs from max(updated, reviewed), so this ' +
        "does not stamp `updated`.",
    },
    {
      name: "evergreen",
      type: "string",
      valueName: "true|false",
      description:
        "Opt the document out of staleness, or back into it. Takes an explicit value: omitting " +
        "the flag leaves the field alone.",
    },
    {
      name: "extra",
      type: "string",
      valueName: "key=value",
      repeated: true,
      description:
        "Set one non-core frontmatter key, repeatably — the agent's way to steward a column's " +
        "`width` (SPEC.md §11) or any plugin key. **The value grammar is total over scalars** — " +
        "every input maps to exactly one JSON scalar, and `--extra-json` is the flag for an " +
        "object or an array: `null` deletes " +
        "the key (RFC 7386), `true`/`false` are booleans, a canonical **finite** JSON number " +
        "(`520`, `-1.5`) is a number, a JSON string literal is its contents " +
        "(`--extra note='\"520\"'` stores the characters), and **everything else is the string " +
        'exactly as typed** — so `007` stays `"007"`, and so does an overflowing literal like ' +
        "`1e400`, which is stored rather than being turned into the deletion `null` would mean. " +
        "A finite integer past `2^53` is taken as a number and rounds the way JSON does " +
        "everywhere else (`9007199254740993` stores as `9007199254740992`); quote it to keep the " +
        "digits. Only the keys named are sent: the rest of `extra` is untouched " +
        "byte-for-byte, never read-modify-written. Naming a **core** key (`title`, `status`, " +
        "`due`, `tags`, `pinned`, `order`, `query`, `column`, `id`, …) is a usage error before " +
        "any request, pointing at the real flag where there is one.",
    },
    {
      name: "extra-json",
      type: "string",
      valueName: "key=json",
      repeated: true,
      description:
        "Set one non-core frontmatter key to a **JSON value**, repeatably — the escape hatch " +
        "`--extra`'s scalar grammar deliberately does not have. The value is parsed as JSON, so " +
        "an object or an array reaches the file as YAML structure: " +
        '`--extra-json publish=\'{"target":"blog","draft":true}\'`, or ' +
        '`--extra-json items=\'[{"text":"Ship it","done":false}]\'` for a plugin key shaped ' +
        "like SPEC.md §12's. Same merge-patch semantics as `--extra` — named keys replace, " +
        "`null` deletes, unnamed keys are untouched — and the same core-key refusal. Depth and " +
        "size are the contract's (`EXTRA_MAX_DEPTH`, `EXTRA_MAX_BYTES`), checked server-side " +
        "over the whole object; the CLI only insists the text is JSON, so a shell-quoting slip " +
        "is a usage error rather than a key that stores a string that looks like an object. A " +
        "key named by both flags is refused rather than silently resolved.",
    },
    ...VIEW_KEY_FLAGS,
    ...bodyFlags("The replacement document body"),
  ],
  examples: [
    {
      command: "corpus doc edit doc_a1b2c3 --from agent <<'EOF'\nThe revised body.\nEOF",
      description:
        "Replace the body from a heredoc, attributed to the agent; the anchor report names any thread that came loose.",
    },
    {
      command: 'corpus doc edit doc_a1b2c3 --title "Mortgage options (2026)"',
      description: "A frontmatter-only edit: the title changes and the body is not touched.",
    },
    {
      command: "corpus doc edit doc_a1b2c3 --add-tag housing --remove-tag draft --reviewed",
      description: 'Retag and mark the document "still current".',
    },
    {
      command: "corpus doc edit doc_v1e2w3 --extra width=520 --from agent",
      description:
        "Widen a board column: the width lives in its `type: view` document's frontmatter, so the board picks it up over SSE with no reload.",
    },
    {
      command: "corpus doc edit doc_v1e2w3 --extra width=null",
      description:
        "Remove the stored width and let the column render at the default; every other `extra` key is left alone.",
    },
    {
      command:
        "corpus doc edit doc_v1e2w3 --query type=thread --query status=open --query tag=finance --from agent",
      description:
        "Reconfigure a column's query: naming any key replaces the whole map, so this is the view's query in full — the board re-renders the column's rows over SSE.",
    },
    {
      command: "corpus doc edit doc_v1e2w3 --pinned false --from agent",
      description:
        "Unpin a view: the column leaves the board live, and the document stays exactly where it is, re-pinnable with `--pinned true`.",
    },
    {
      command: "corpus doc edit doc_v1e2w3 --order 1.5 --from agent",
      description:
        "Reorder: a midpoint lands the column between the first and second without renumbering the rest of the board.",
    },
    {
      command: 'corpus doc edit doc_t0d0s1 --extra-json publish=\'{"target":"blog"}\'',
      description:
        "Store a plugin key whose value is an object; `--extra` stores scalars, and this is how the same merge patch carries structure.",
    },
    {
      command: "corpus doc edit doc_a1b2c3 --file revised.md --json",
      description:
        "One JSON value carrying `doc`, `anchors.remapped`, `anchors.orphaned` and `warnings`, exactly as the server sent them.",
    },
  ],
  handler: (context) => runDocEdit(context),
};
