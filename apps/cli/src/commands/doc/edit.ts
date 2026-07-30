import {
  DOC_STATUSES,
  RESERVED_FRONTMATTER_KEYS,
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
 * (CLI-017, sprint-017 Adjudication 13).
 *
 * `PUT /api/docs/{id}` writes frontmatter and nothing else, so `--status open`
 * on an archived document reported success while producing a half-state: the
 * frontmatter said `open`, the skill folder stayed in `.claude/skills-archived/`
 * (disabled, invisible to Claude Code) and the name stayed `409`-blocked. The
 * verb that undoes archiving is `corpus doc unarchive`, because unarchiving is a
 * filesystem move and a name release, not a field edit — and a verb that reports
 * success while leaving the document unreachable by the very operation the
 * caller was enabling is worse than one that fails.
 *
 * So the refusal names the verb. The agent is CLI-only and reads error messages
 * as instructions; "run `corpus doc unarchive <id>`" turns a dead end into a next
 * step. The guard is narrow on purpose — it fires only when the document is
 * *already* archived and the new status is not `archived` — so every ordinary
 * status edit, and re-archiving an archived document, behave exactly as before.
 */
function assertNotArchived(current: Doc, id: string, status: DocStatus): void {
  if (current.frontmatter.status !== "archived" || status === "archived") return;
  throw new UsageError(
    `${id} is archived; \`--status ${status}\` would set the frontmatter without bringing the document back.`,
    {
      hint: `Run \`corpus doc unarchive ${id}\` — it restores the status and, for a skill, moves its folder back out of \`.claude/skills-archived/\` and frees the name.`,
    },
  );
}

/**
 * The `--extra` value grammar (CLI-016, sprint-017 Adjudication 12). Total by
 * construction: every input maps to exactly one JSON value, and the rules are
 * published in the flag's own description, which is what `docs/cli.md` carries.
 *
 * 1. `null` deletes the key — the server's `extra` patch is RFC 7386, so `null`
 *    removes rather than stores (`apps/server/src/docs/update.ts`).
 * 2. `true` / `false` are booleans.
 * 3. A **canonical** JSON number literal is a number. Canonical matters: `007`
 *    and `1.` are not JSON numbers, so they stay strings and an identifier that
 *    happens to be digits is not silently arithmetic.
 * 4. A JSON **string literal** is its own contents — the escape hatch that lets
 *    `--extra note='"520"'` store the characters `520`, and the only way to
 *    store the literal text `null`.
 * 5. Everything else is the string exactly as typed, including the empty one.
 *
 * Numbers are rule 3 rather than an opt-in because the one promise this flag
 * exists to keep needs one: the board reads `extra.width` with
 * `typeof raw !== "number"` and falls back to its default for anything else
 * (`apps/ui/src/board/columnWidth.ts`), so `--extra width=520` storing `"520"`
 * would be a passing unit test and a column that never widens.
 */
export function parseExtraValue(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (JSON_NUMBER.test(raw)) return Number(raw);
  if (raw.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Not a JSON string literal after all — rule 5 takes it verbatim.
    }
  }
  return raw;
}

const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/**
 * Core keys that have a flag of their own. The **refusal** list is the
 * contract's `RESERVED_FRONTMATTER_KEYS` and is never hand-copied — this map
 * only makes the message actionable, so a key the contract adds tomorrow is
 * still refused, just with the generic hint.
 */
const FLAG_FOR_RESERVED_KEY: Readonly<Record<string, string>> = {
  title: "--title",
  status: "--status",
  due: "--due",
  reviewed: "--reviewed",
  evergreen: "--evergreen",
  tags: "--add-tag`/`--remove-tag",
};

const RESERVED_KEYS: ReadonlySet<string> = new Set(RESERVED_FRONTMATTER_KEYS);

/**
 * `--extra` may never name a core field. The contract already refuses one with a
 * `400` (`ExtraFrontmatterSchema`), and that backstop stays exactly where it is:
 * this guard is a **better error message**, not the enforcement. An agent gets
 * one chance to read a failure and act on it, and "use `--title`" is a next step
 * where a round-tripped validation issue is a puzzle.
 */
function assertWritableExtraKey(key: string): void {
  if (!RESERVED_KEYS.has(key)) return;
  const flag = FLAG_FOR_RESERVED_KEY[key];
  throw new UsageError(
    `\`${key}\` is a core frontmatter key, not an \`extra\` key — \`--extra ${key}=…\` is refused.`,
    {
      hint:
        flag === undefined
          ? `Core keys are not user-writable through \`--extra\`; \`extra\` may never shadow one.`
          : `Use \`${flag}\` instead.`,
    },
  );
}

/** `key=value` pairs into the merge patch the `PUT` carries, or nothing at all. */
export function parseExtraFlags(entries: readonly string[]): Record<string, unknown> | undefined {
  if (entries.length === 0) return undefined;

  const extra: Record<string, unknown> = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      throw new UsageError(`--extra takes \`key=value\` — got "${entry}", which has no \`=\`.`, {
        hint: "For example: --extra width=520, or --extra width=null to remove the key.",
      });
    }
    if (separator === 0) {
      throw new UsageError(`--extra "${entry}" names no key.`, {
        hint: "The key comes before the `=`: --extra width=520.",
      });
    }
    const key = entry.slice(0, separator);
    assertWritableExtraKey(key);
    // Last one wins, like any repeated assignment; `--extra a=1 --extra a=2`
    // sends `a: 2` rather than failing on a contradiction the caller can see.
    extra[key] = parseExtraValue(entry.slice(separator + 1));
  }
  return extra;
}

export async function runDocEdit(
  context: WorkspaceCommandContext,
  dependencies: EditDependencies = {},
): Promise<void> {
  const id = context.args.get("id");
  const body = await resolveBody(context, dependencies);
  const read = currentDocument(context, id);

  const title = context.flags.string("title");
  const status = parseStatus(context.flags.string("status"));
  const due = context.flags.string("due");
  const reviewed = context.flags.boolean("reviewed");
  const evergreen = parseTriStateBoolean("evergreen", context.flags.string("evergreen"));
  const extra = parseExtraFlags(context.flags.strings("extra"));

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
  };

  if (body === undefined && Object.keys(patch).length === 0) {
    throw new UsageError(`nothing to change on ${id}.`, {
      hint: "Pipe a body in, or name a field: --title, --add-tag, --remove-tag, --status, --due, --reviewed, --evergreen, --extra.",
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
    "current tags first and `--status` reads the current status, so those flags cost one extra " +
    "request; nothing else does — and because the API " +
    "offers no conditional write, two tag edits racing on one document can end with only the " +
    "later one's tag. **`--status` refuses to move an archived document off `archived`** — that " +
    "would set the frontmatter while leaving a skill's folder disabled in " +
    "`.claude/skills-archived/` and its name blocked, so the refusal names " +
    "`corpus doc unarchive <id>` instead. `--extra` writes non-core frontmatter keys — the " +
    "column `width` of SPEC.md §11 among them — as a merge patch: named keys replace, `null` " +
    "removes, unnamed keys are untouched. A `423` from the " +
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
        "Set the lifecycle status: `open`, `resolved` or `archived`. On an **archived** document " +
        "anything but `archived` is refused, naming `corpus doc unarchive <id>` — the verb that " +
        "actually brings a document back.",
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
        "`width` (SPEC.md §11) or any plugin key. **The value grammar is total**: `null` deletes " +
        "the key (RFC 7386), `true`/`false` are booleans, a canonical JSON number (`520`, `-1.5`) " +
        "is a number, a JSON string literal is its contents (`--extra note='\"520\"'` stores the " +
        "characters), and **everything else is the string exactly as typed** — so `007` stays " +
        '`"007"`. Only the keys named are sent: the rest of `extra` is untouched ' +
        "byte-for-byte, never read-modify-written. Naming a **core** key (`title`, `status`, " +
        "`due`, `tags`, `id`, …) is a usage error before any request, pointing at the real flag " +
        "where there is one.",
    },
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
      command: "corpus doc edit doc_a1b2c3 --file revised.md --json",
      description:
        "One JSON value carrying `doc`, `anchors.remapped`, `anchors.orphaned` and `warnings`, exactly as the server sent them.",
    },
  ],
  handler: (context) => runDocEdit(context),
};
