import {
  DOCUMENT_KEY_PATTERN,
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
  JOB_FLAG,
  resolveJob,
} from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import {
  combineExtraPatches,
  parseExtraFlags,
  parseExtraJsonFlags,
  parseViewFlags,
  VIEW_KEY_FLAGS,
} from "./frontmatter.js";
import { keyLine } from "./render.js";

/**
 * The value grammar and the `--extra` parser moved to `./frontmatter.js` when
 * `doc create` grew the same flags (CLI-018); they are re-exported because this
 * verb is where they are documented and where their tests live.
 */
export { parseExtraFlags, parseExtraValue } from "./frontmatter.js";

/**
 * `corpus doc edit` — the save path, and the one place anchor reconciliation is
 * guaranteed to run (SPEC.md §6). The CLI's whole contribution is assembling the
 * patch: the server serialises the write, reconciles the anchors against the
 * body as it exists on disk, writes and commits.
 *
 * Three details matter for the agent's loop:
 *
 * - **Replacing the body means presenting a key** (SPEC.md §7, SHARED-041).
 *   `--key` is the value `corpus doc show` printed, and a body edit without one
 *   is a usage error *here*, before anything is sent — the server refuses it too
 *   (`400` naming `body.key`), and refusing twice is deliberate: the enforcement
 *   that matters is the server's, and this one exists so the message names a
 *   command instead of a field. **A write that names its own delta needs no
 *   key** — `--add-tag`, `--status`, `--folder`, a view key — and none of them
 *   started asking for one. Passing `--key` alongside them anyway is welcome and
 *   is still checked, so a caller that always presents what it read needs no
 *   rule about which fields are which.
 * - **A frontmatter-only edit sends no `body` key.** An empty body would be an
 *   instruction to wipe the document, so "no body source" and "an empty body"
 *   must stay distinguishable all the way to the wire.
 * - **The reconciliation report is rendered, not swallowed.** A detached thread
 *   is something the agent has to notice, so it is on the success line and, under
 *   `--json`, exactly as the server sent it.
 *
 * Every write that lands answers with a fresh key, which this verb prints on the
 * line after the confirmation: a chain of edits therefore needs exactly one read
 * at the start, not one between every pair of writes.
 */

/** ISO instants are written to seconds, matching what the server stamps into frontmatter. */
export function instantNow(now: () => number = Date.now): string {
  return new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface EditDependencies extends InputDependencies {
  readonly now?: () => number;
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
 * `--key`, checked for **shape** only, and only so that a value that was never a
 * key fails as the mistake it is.
 *
 * The pattern is the contract's own (`DOCUMENT_KEY_PATTERN`), not a guess about
 * one: a key is a fixed-width lowercase hex string, and the two ways an agent
 * arrives here with something else are a truncated copy (a wrapped line) and a
 * wrong value entirely (the document's id, a path). Both are usage errors — the
 * invocation is malformed — and neither should reach the server as a `409`,
 * because a stale key means *re-read and merge* and a truncated one means *you
 * did not copy the whole line*, and sending the agent down the first path for
 * the second mistake costs a round trip and teaches it the wrong lesson.
 *
 * Checking the shape is **not** parsing a key: nothing here reads meaning out of
 * one, orders one, or shortens one. The value is echoed onward untouched.
 */
function parseKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (DOCUMENT_KEY_PATTERN.test(value)) return value;
  throw new UsageError(`--key is not a document key: "${value}".`, {
    hint:
      "A key is the whole value `corpus doc show <id>` printed on its `key` line — copy it " +
      "entire, exactly as it was printed. Nothing was sent to the server.",
  });
}

/**
 * What a body-replacing write with no key is told (SPEC.md §7).
 *
 * The refusal has to be **actionable from its own text**, because an agent that
 * cannot recover from a message guesses, and the guess here is a lost edit. So
 * it names the two commands in the order they are run, and says why the rule
 * exists in one clause — a body write states nothing about what it changes, so
 * it is the write that can destroy silently.
 */
function missingKey(id: string): UsageError {
  return new UsageError(`replacing the body of ${id} needs its \`--key\`.`, {
    hint:
      `Read the document first — \`corpus doc show ${id}\` prints its \`key\` — then send this ` +
      `edit again with \`--key <key>\`. The key names the version you read, so writing without ` +
      `one is writing over something you never saw (SPEC.md §7). A write that names its own ` +
      `delta (--add-tag, --status, --folder, a view key) needs no key. Nothing was sent to the ` +
      `server.`,
  });
}

/**
 * The document as it stands, read at most once per invocation.
 *
 * **Exactly one flag needs it**, and only `--status`: to know whether the
 * document is archived, so the refusal can name a command (see
 * {@link assertNotArchived}). `--add-tag`/`--remove-tag` used to need it too —
 * they read the list to merge against — until SERVER-102 moved that merge to the
 * server, where it belongs. It stays memoized against a second caller appearing,
 * and naming no such flag costs no request at all, which is what keeps the
 * ordinary body, title or tag edit a single round trip.
 *
 * **What it never does is supply the key.** This response carries one, and using
 * it would turn every body edit into a read the CLI performed on the caller's
 * behalf — a key obtained by the writer's own tooling rather than by the writer
 * having read the document, which is precisely the evidence §7 asks for and
 * exactly how the lock became forgettable. The agent carries the key explicitly
 * (SHARED-041 decision 1) or the write does not happen.
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
 * The read this needs is one `GET`, and it is now the **only** read this verb
 * makes: the tag flags stopped reading in SERVER-102, and this one stays because
 * what it buys is a *message*, not a decision. It carries an accepted staleness
 * — the document could be archived, or unarchived, between the read and the
 * `PUT` — and that costs nothing either way, because the server re-checks while
 * it holds the document (SERVER-039): a document archived inside the window is
 * refused there instead of here, with the same rule and a `400`. Nothing about
 * correctness rests on this snapshot, which is exactly why it may be one.
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
  const key = parseKey(context.flags.string("key"));

  const body = await resolveBody(context, dependencies);
  // **The one check that deliberately runs after stdin is drained.** Every other
  // guard above is pure and ends the command before the caller's heredoc is
  // touched; this one cannot be, because whether a key is required is exactly
  // the question "is a body being sent", and only `resolveBody` answers it — a
  // `--message`, a `--file`, an empty pipe and a socket on fd 0 all resolve
  // differently. Asking earlier would mean guessing, and guessing wrong in the
  // strict direction refuses a frontmatter-only edit that was never keyed. The
  // payload is not lost either way: the retry has to carry the body again
  // regardless, because nothing was written.
  if (body !== undefined && key === undefined) throw missingKey(id);
  const read = currentDocument(context, id);

  if (status !== undefined) assertNotArchived(await read(), id, status);

  // **The delta goes on the wire; the merge is the server's** (SERVER-102).
  // These flags used to read the document, merge in the client and send the
  // whole set — which is how two concurrent `--add-tag` calls each landed a
  // `200` and left one tag on disk. `addTags`/`removeTags` state the change, and
  // the server applies it against the file it is holding, inside the document's
  // write lane. There is no window to lose a tag in and no read to pay for: a
  // tag edit is now exactly one request, like every other named delta.
  const added = context.flags.strings("add-tag");
  const removed = context.flags.strings("remove-tag");

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
    // Copied rather than passed through: `flags.strings` answers `readonly
    // string[]`, and the generated request body is mutable.
    ...(added.length === 0 ? {} : { addTags: [...added] }),
    ...(removed.length === 0 ? {} : { removeTags: [...removed] }),
    // Only the keys the caller named: `extra` is a merge patch, so sending the
    // whole object back would race every other writer of a key this invocation
    // never mentioned.
    ...(extra === undefined ? {} : { extra }),
    // The §10 view keys are *not* a merge patch — each is one core field, and
    // an unnamed one is simply absent here.
    ...view,
  };

  // `--key` is not a change and is not counted as one: an edit that presents a
  // key and names nothing else has still asked for nothing, and sending it would
  // trade a usage error for a write that rewrites the document with itself.
  if (body === undefined && Object.keys(patch).length === 0) {
    throw new UsageError(`nothing to change on ${id}.`, {
      hint: "Pipe a body in, or name a field: --title, --add-tag, --remove-tag, --status, --due, --reviewed, --evergreen, --extra, --extra-json, --pinned, --order, --query.",
    });
  }

  const job = resolveJob(context.flags, context.env);

  const response = await context.client.request((api) =>
    api.PUT("/api/docs/{id}", {
      params: { path: { id } },
      body: {
        ...patch,
        // SPEC.md §9.2: the work this write serves (CLI-044).
        ...(job === undefined ? {} : { job }),
        ...(key === undefined ? {} : { key }),
        ...(body === undefined ? {} : { body }),
      },
    }),
  );

  context.out.emit(response);
  context.out.line(
    `edited ${id}${describeAnchors(response.anchors, response.doc)}${warningSuffix(response.warnings)}`,
  );
  // The fresh key, on its own line, because §7's "every write that lands gives
  // you a fresh key for the next one" is only true for the agent if the CLI says
  // what it is. Without it a chain of edits costs a read between every pair.
  context.out.line(keyLine(response.doc));
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
    "is deliberately not an edit (SPEC.md §5). **`--add-tag`/`--remove-tag` send the change, not " +
    "the resulting list**, so the server merges them against the document while it holds it: two " +
    "tag edits racing on one document both land, and neither needs a key or a read first " +
    "(SPEC.md §7 — a write that names its own delta merges with whatever else happened). Only " +
    "`--status` costs an extra request, and only to phrase the archived refusal below from a " +
    "one-round-trip-old snapshot; the server re-checks it regardless. " +
    "**`--status` refuses to move an archived document off `archived`** and names " +
    "`corpus doc unarchive <id>` instead — for a `type: skill` document because the frontmatter " +
    "would say `open` while the folder stayed disabled in `.claude/skills-archived/` and its " +
    "name stayed blocked, and for every other type because un-archiving is its own operation. " +
    "The server refuses the same write (SERVER-039); refusing it here costs no round trip and " +
    "names a **command** where the server can only name a route. `--extra` and `--extra-json` " +
    "write non-core frontmatter keys — the " +
    "column `width` of SPEC.md §10 among them — as a merge patch: named keys replace, `null` " +
    "removes, unnamed keys are untouched. `--pinned`, `--order` and `--query` write " +
    "the three **view keys** of SPEC.md §10, which are core fields rather than `extra` ones: a " +
    "board column IS a `type: view` document with `pinned: true`, so pinning, reordering and " +
    "reconfiguring one is this verb, and the board follows over SSE with no reload. An edit that " +
    "names no change at all is a usage error, not an empty request.\n\n" +
    "**Replacing the body means presenting the document's `--key`** (SPEC.md §7). Read the " +
    "document with `corpus doc show <id>`, which prints the key, and present that key here: a " +
    "body edit without one is refused before anything is sent (exit 2), because a write that " +
    "replaces a block says nothing about what it changes and is the one that can destroy " +
    "silently. If the document moved on between that read and this write, the key is stale and " +
    "the write is **refused with exit 9** — carrying the document as it now stands and a fresh " +
    "key, so no second read is needed: reconcile against what is printed and run the same command " +
    "again with the fresh key. **That retry is the mechanism working, not a failure.** Every " +
    "write that lands prints the fresh key on the line after the confirmation, so a chain of " +
    "edits costs one read at the start rather than one between every pair.\n\n" +
    "**A write that names its own delta needs no key**, and none of them started asking for one: " +
    "`--add-tag`, `--remove-tag`, `--status`, `--due`, `--reviewed`, `--evergreen`, `--extra`, " +
    "`--extra-json` and the view keys all merge with whatever else happened rather than " +
    "overwriting it, as do `corpus doc move|archive|unarchive`. Presenting `--key` alongside them " +
    "anyway is welcome and is still checked, so a caller that always sends what it read needs no " +
    "rule about which fields are which.",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [
    {
      name: "key",
      type: "string",
      valueName: "key",
      description:
        "The document's **key**, exactly as `corpus doc show <id>` printed it — the version this " +
        "edit is written against (SPEC.md §7). **Required when the edit replaces the body**; " +
        "accepted, and still checked, on every other write. A key the document has moved past is " +
        "refused with exit 9, and the refusal carries the document as it now stands with a fresh " +
        "key, so the retry needs no extra read. It is opaque: echo it back exactly, and never " +
        "construct, shorten, split or order one. There is nothing to acquire and nothing to " +
        "release — reading gives you a key, not a claim on the document.",
    },
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
        "`width` (SPEC.md §10) or any other key the core does not define. **The value grammar is " +
        "total over scalars** — " +
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
        "`due`, `tags`, `pinned`, `order`, `query`, `id`, …) is a usage error before " +
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
        '`--extra-json items=\'[{"text":"Ship it","done":false}]\'` for a key whose value is a ' +
        "list of objects. Same merge-patch semantics as `--extra` — named keys replace, " +
        "`null` deletes, unnamed keys are untouched — and the same core-key refusal. Depth and " +
        "size are the contract's (`EXTRA_MAX_DEPTH`, `EXTRA_MAX_BYTES`), checked server-side " +
        "over the whole object; the CLI only insists the text is JSON, so a shell-quoting slip " +
        "is a usage error rather than a key that stores a string that looks like an object. A " +
        "key named by both flags is refused rather than silently resolved.",
    },
    ...VIEW_KEY_FLAGS,
    ...bodyFlags("The replacement document body"),
    JOB_FLAG,
  ],
  examples: [
    {
      command:
        "corpus doc show doc_a1b2c3\n" +
        "corpus doc edit doc_a1b2c3 --key <the key that read printed> --from agent <<'CORPUS_EOF'\n" +
        "The revised body.\nCORPUS_EOF",
      description:
        "The whole loop: read the document — which is both how you see what you are revising and where its key comes from — then replace the body presenting that key. The anchor report names any thread that came loose, and the write prints the fresh key for the next edit.",
    },
    {
      command: 'corpus doc edit doc_a1b2c3 --title "Mortgage options (2026)"',
      description:
        "A frontmatter-only edit: the title changes, the body is not touched, and no key is needed — a title names its own delta.",
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
      command: 'corpus doc edit doc_a1b2c3 --extra-json publish=\'{"target":"blog"}\'',
      description:
        "Store a non-core key whose value is an object; `--extra` stores scalars, and this is how the same merge patch carries structure.",
    },
    {
      command: 'corpus doc edit doc_a1b2c3 --file revised.md --key "$key" --json',
      description:
        "One JSON value carrying `doc`, `anchors.remapped`, `anchors.orphaned` and `warnings`, exactly as the server sent them — `doc.key` is the fresh key.",
    },
    {
      command: "corpus doc edit doc_a1b2c3 --key \"$stale\" -m 'New text' ; echo $?",
      description:
        "A key the document has moved past: exit **9**, nothing written, and the refusal prints the document as it now stands with its fresh key — reconcile against that and run the same command again with it.",
    },
  ],
  handler: (context) => runDocEdit(context),
};
