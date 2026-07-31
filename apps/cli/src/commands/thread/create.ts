import { UsageError } from "../../errors.js";
import {
  bodyFlags,
  parseTriStateBoolean,
  requireBody,
  warningSuffix,
  type InputDependencies,
} from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus thread create` — the agent's half of SPEC.md §6's "a comment on a
 * document creates a thread", and the verb that makes §7's "the agent interacts
 * with the system only through the CLI" true of *starting* a conversation rather
 * than only of continuing one.
 *
 * `POST /api/threads` has three creation shapes and this verb reaches all three,
 * chosen entirely by which flags are present:
 *
 *   - `--parent` + `--quote` — **anchored**. The server derives the anchor from
 *     the quote, writes the entry into the parent's frontmatter and creates the
 *     thread file in one atomic mutation.
 *   - `--parent` alone — **whole-document**. A comment about the document, with
 *     no highlight in it.
 *   - neither — **standalone**. The conversation is the whole context; the
 *     composer's _Ask_, from a command line.
 *
 * **No selector is constructed here.** The CLI sends the quote it was given and
 * nothing else: it does not fetch the parent, does not search its body for the
 * quote, and does not compute `prefix`/`suffix` context. Resolution is the
 * server's ladder (SPEC.md §6) and it is not a write-time gate — a quote the
 * parent does not contain, or one it contains twice with no context to tell the
 * occurrences apart, still creates the thread and comes back carrying §14's
 * `orphaned_anchor` warning, which the printed line reports like every other
 * warning. That is the server's judgement surfacing, not a check re-implemented
 * here; `--prefix`/`--suffix` are how a caller disambiguates a repeated quote.
 */

/** A flag whose presence is an instruction: given but blank is a typo, not a value. */
function textFlag(context: WorkspaceCommandContext, name: string): string | undefined {
  const value = context.flags.string(name);
  if (value === undefined) return undefined;
  if (value === "") {
    throw new UsageError(`--${name} was given without a value.`, {
      hint: `Pass the text: --${name} "…", or leave the flag out entirely.`,
    });
  }
  return value;
}

export async function runThreadCreate(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies = {},
): Promise<void> {
  const parent = textFlag(context, "parent");
  const quote = textFlag(context, "quote");
  const prefix = textFlag(context, "prefix");
  const suffix = textFlag(context, "suffix");
  const title = textFlag(context, "title");
  const requestsAgent = parseTriStateBoolean(
    "requests-agent",
    context.flags.string("requests-agent"),
  );

  // Two flag combinations carry no request at all, so they are usage errors
  // rather than a round trip: context with nothing to disambiguate has nowhere
  // to go on the wire, and a quote with no document to anchor to cannot be
  // honoured (the server refuses it too, and losing the caller's quote silently
  // would be worse than either).
  if (quote === undefined && (prefix !== undefined || suffix !== undefined)) {
    throw new UsageError("--prefix and --suffix describe the text around --quote.", {
      hint: 'Pass the quote itself: --quote "…".',
    });
  }
  if (quote !== undefined && parent === undefined) {
    throw new UsageError("--quote needs a document to anchor to.", {
      hint: "Pass --parent <doc-id>, or drop --quote for a standalone thread.",
    });
  }

  // The contract's `body` is `min(1)`: a thread with no first turn is not a
  // thread, so an empty one is a usage error here rather than a request the
  // server was always going to reject.
  const body = await requireBody(context, "first turn", dependencies);

  const response = await context.client.request((api) =>
    api.POST("/api/threads", {
      body: {
        body,
        // Every optional field is *omitted* rather than sent as undefined:
        // `requestsAgent` is a tri-state where omitted, true and false are three
        // different instructions (SPEC.md §8), and a null selector is not the
        // same request as an absent one.
        ...(parent === undefined ? {} : { parent }),
        ...(quote === undefined
          ? {}
          : {
              selector: {
                exact: quote,
                ...(prefix === undefined ? {} : { prefix }),
                ...(suffix === undefined ? {} : { suffix }),
              },
            }),
        ...(title === undefined ? {} : { title }),
        ...(requestsAgent === undefined ? {} : { requestsAgent }),
      },
    }),
  );

  context.out.emit(response);
  const queued = response.eventId === null ? "" : ` (queued ${response.eventId})`;
  context.out.line(
    `created ${response.thread.id} — ${placement(response.thread.parent, response.anchorId)}` +
      `${queued}${warningSuffix(response.warnings)}`,
  );
}

/** Which of the three shapes the server actually wrote, read back off its answer. */
function placement(parent: string | null, anchorId: string | null): string {
  if (parent === null) return "standalone";
  if (anchorId === null) return `on ${parent} (whole document)`;
  return `anchored at ${anchorId} on ${parent}`;
}

export const createCommand: WorkspaceCommandSpec = {
  name: "create",
  summary: "Open a thread on a selection, on a whole document, or standalone.",
  description:
    "The three creation shapes of SPEC.md §6, chosen by which flags are present. `--parent` with " +
    "`--quote` anchors the thread to that text: the server derives the text-quote selector, writes " +
    "the anchor entry into the parent's frontmatter and creates the thread file in **one** atomic " +
    "mutation, so a highlight never points at a conversation that was not written. `--parent` " +
    "alone comments on the whole document, and neither flag opens a standalone thread whose " +
    "conversation is its own context. The first turn's body comes from `-m`, `--file` or stdin — " +
    "the heredoc form the agent's skills use — and is mandatory: a thread with no first turn is " +
    "not a thread (exit 2, no request). Bytes are passed through untouched.\n\n" +
    "**The quote is not resolved here.** The CLI never reads the parent document and never " +
    "computes the surrounding context: it sends the text you quoted, and the server matches it " +
    "(SPEC.md §6). Matching is not a gate — a quote the document does not contain, or one it " +
    "contains twice with nothing to tell the occurrences apart, still creates the thread and " +
    "comes back with the `orphaned_anchor` warning appended to the printed line, because an " +
    "orphaned anchor is a normal state of a living corpus rather than a rejected request. Pass " +
    "`--prefix`/`--suffix` — the text immediately before and after the quote — to disambiguate a " +
    "repeated quote. An unknown `--parent` is a `404` (exit 5), and a parent held by the other " +
    "party's edit lock refuses an _anchored_ create with a `423`, since anchoring rewrites it " +
    "(SPEC.md §7); a whole-document or standalone thread takes no lock. Prints the new thread's " +
    "id, where it landed, and any enqueued event; `--json` emits the server's " +
    "`{thread, anchorId, eventId, warnings}` response unchanged.",
  args: [],
  flags: [
    {
      name: "parent",
      type: "string",
      valueName: "doc-id",
      description:
        "Document being commented on, which may itself be a thread. Omit it for a standalone thread.",
    },
    {
      name: "quote",
      type: "string",
      valueName: "text",
      description:
        "The exact text in the parent to anchor the thread to, copied verbatim — nothing is " +
        "trimmed or normalised, because the anchor resolves on those exact characters. Requires " +
        "`--parent`; omit it to comment on the whole document.",
    },
    {
      name: "prefix",
      type: "string",
      valueName: "text",
      description:
        "Text immediately preceding the quote, for disambiguation. Only needed when the quote " +
        "occurs more than once in the parent.",
    },
    {
      name: "suffix",
      type: "string",
      valueName: "text",
      description: "Text immediately following the quote, for disambiguation.",
    },
    {
      name: "title",
      type: "string",
      valueName: "text",
      description:
        "The thread's title. Defaults to one the server derives from the anchor quote, the " +
        "parent's title, or the first turn.",
    },
    {
      name: "requests-agent",
      type: "string",
      valueName: "true|false",
      description:
        "The composer's _ask agent_ toggle (SPEC.md §8). Omitted, the agent is woken only when the " +
        "body carries an explicit `@agent` mention, a targeted `@<subagent>` mention or a " +
        "`/<skill>` invocation. `true` requests it regardless; `false` is _note only_ and " +
        "suppresses the wake even when the body mentions it.",
    },
    ...bodyFlags("The first turn's body"),
  ],
  examples: [
    {
      command:
        'corpus thread create --parent doc_a1b2c3 --quote "assume a 30-year fixed at 6.1%" -m "@agent is this still right?"',
      description:
        "An anchored comment: the highlight lands in `doc_a1b2c3`'s frontmatter and the mention wakes the agent.",
    },
    {
      command:
        "corpus thread create --parent doc_a1b2c3 --from agent <<'EOF'\nI split this into two notes; the second needs a title.\nEOF",
      description:
        "A whole-document thread from the agent, body as a heredoc, committed with `agent` as the git author.",
    },
    {
      command:
        'corpus thread create --parent doc_a1b2c3 --quote "6.1%" --prefix "fixed at " --suffix " which"',
      description:
        "Disambiguating a quote that appears more than once, with the text around it. Body from stdin.",
    },
    {
      command: 'corpus thread create -m "Where did the Q3 numbers end up?" --requests-agent true',
      description: "A standalone thread — no parent, no anchor — that asks the agent directly.",
    },
    {
      command: 'corpus thread create --parent doc_a1b2c3 --quote "6.1%" --file question.md --json',
      description:
        'One JSON value — `{"thread":{…},"anchorId":"anc_k4f7","eventId":null,"warnings":[]}` — for a caller that needs the ids.',
    },
  ],
  handler: (context) => runThreadCreate(context),
};
