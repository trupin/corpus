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
 * the current tags have to be read first. Only these two flags cost a read — a
 * plain body or title edit is exactly one request, which is what keeps a lock
 * conflict a single, un-retried failure.
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

async function resolveTags(
  context: WorkspaceCommandContext,
  id: string,
): Promise<string[] | undefined> {
  const added = context.flags.strings("add-tag");
  const removed = context.flags.strings("remove-tag");
  if (added.length === 0 && removed.length === 0) return undefined;

  const current = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id } } }),
  );
  return mergeTags(current.frontmatter.tags, added, removed);
}

export async function runDocEdit(
  context: WorkspaceCommandContext,
  dependencies: EditDependencies = {},
): Promise<void> {
  const id = context.args.get("id");
  const body = await resolveBody(context, dependencies);

  const title = context.flags.string("title");
  const status = parseStatus(context.flags.string("status"));
  const due = context.flags.string("due");
  const reviewed = context.flags.boolean("reviewed");
  const evergreen = parseTriStateBoolean("evergreen", context.flags.string("evergreen"));
  const tags = await resolveTags(context, id);

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
  };

  if (body === undefined && Object.keys(patch).length === 0) {
    throw new UsageError(`nothing to change on ${id}.`, {
      hint: "Pipe a body in, or name a field: --title, --add-tag, --remove-tag, --status, --due, --reviewed, --evergreen.",
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
    "current tags first, so they cost one extra request; nothing else does. A `423` from the " +
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
      description: "Set the lifecycle status: `open`, `resolved` or `archived`.",
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
      command: "corpus doc edit doc_a1b2c3 --file revised.md --json",
      description:
        "One JSON value carrying `doc`, `anchors.remapped`, `anchors.orphaned` and `warnings`, exactly as the server sent them.",
    },
  ],
  handler: (context) => runDocEdit(context),
};
