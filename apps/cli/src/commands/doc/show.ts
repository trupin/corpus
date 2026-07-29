import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus doc show` — the CLI's first document *read* (SPEC.md §5, §7). The
 * agent interacts with the system only through the CLI (CLAUDE.md Architecture
 * Decision 2), and a document's state is not fully recoverable from its file:
 * anchors resolve against the *current* body at read time, so whether a thread
 * is still attached is something only `GET /api/docs/{id}` can answer. Parsing
 * the markdown would answer it wrongly.
 *
 * The verb is one request and a rendering. It prints the frontmatter a person
 * reads first, the anchored threads with their resolution state — the context
 * §7's comment skill needs before replying — and then the body. Everything the
 * endpoint returns, including the view keys and the plugin `extra` block, is in
 * `--json`; the human rendering is a summary and says so.
 *
 * Timestamps that the file genuinely lacks (a hand-written `SKILL.md` has none)
 * render as “—”, never as a substituted date: the contract prescribes it, and
 * "we do not know" is not "1970".
 */

/** What an absent value renders as — the contract's own prescription for null. */
const NONE = "—";

/** Anchor quotes are one line of context, not the passage; longer ones are cut. */
const MAX_QUOTE = 60;

export async function runDocShow(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");
  const doc = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id } } }),
  );

  context.out.emit(doc);

  const { frontmatter } = doc;
  context.out.line(frontmatter.title);
  context.out.line(`${frontmatter.id} · ${frontmatter.type} · ${frontmatter.status}`);
  context.out.line(doc.path);
  context.out.line(
    `created ${frontmatter.created ?? NONE} · updated ${frontmatter.updated ?? NONE}`,
  );
  context.out.line(`tags ${frontmatter.tags.length === 0 ? NONE : frontmatter.tags.join(", ")}`);

  // Only when the document actually carries one of them: an always-printed
  // "due — · reviewed — · evergreen no" is noise on every note in the corpus.
  if (frontmatter.due !== null || frontmatter.reviewed !== null || frontmatter.evergreen) {
    context.out.line(
      `due ${frontmatter.due ?? NONE} · reviewed ${frontmatter.reviewed ?? NONE} · evergreen ${
        frontmatter.evergreen ? "yes" : "no"
      }`,
    );
  }

  if (doc.anchors.length > 0) {
    context.out.line("anchors:");
    for (const anchor of doc.anchors) {
      const position =
        anchor.orphaned || anchor.range === null
          ? "orphaned, its quote is no longer in the body"
          : `chars ${String(anchor.range.start)}–${String(anchor.range.end)}`;
      context.out.line(
        `  ${anchor.anchorId} → ${anchor.threadId} (${anchor.threadStatus}) · ${position} · "${oneLine(anchor.selector.exact)}"`,
      );
    }
  }

  context.out.line("");
  context.out.line(doc.body.trim() === "" ? "(no body)" : doc.body.trimEnd());
}

/** An anchor's quote, collapsed to a single line so one anchor is one line. */
function oneLine(exact: string): string {
  const collapsed = exact.replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_QUOTE ? collapsed : `${collapsed.slice(0, MAX_QUOTE - 1)}…`;
}

export const showCommand: WorkspaceCommandSpec = {
  name: "show",
  summary: "Read a document: its frontmatter, its anchored threads, and its body.",
  description:
    "Reads `GET /api/docs/{id}` and prints what the server returned — the CLI never opens the " +
    // `_current_` rather than `*current*`: Prettier normalises markdown emphasis
    // when it formats the generated `docs/cli.md`, and the drift check compares
    // the formatted file against this string.
    "file. That matters for anchors: they are resolved against the _current_ body at read time, " +
    "so each one is listed with the thread it belongs to, that thread's status, and either the " +
    "character range it landed on or the fact that it is orphaned (SPEC.md §6). A timestamp the " +
    "file does not carry renders as “—” rather than as an invented date. The human rendering is " +
    "a summary: the whole payload — including the §11 view keys and any plugin `extra` — is what " +
    "`--json` emits, unchanged. An id that names no document is the server's `404`, which is " +
    "exit 5.",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [],
  examples: [
    {
      command: "corpus doc show doc_a1b2c3",
      description:
        "Read a document before editing or commenting on it: header, anchored threads, then the body.",
    },
    {
      command: "corpus doc show doc_a1b2c3 --json",
      description:
        'One JSON value: `{"frontmatter":{"id":"doc_a1b2c3","type":"note","title":"Mortgage ' +
        'options","created":"2026-07-28T10:00:00.000Z","updated":null,…},"body":"30-year fixed at ' +
        '6.1%.\\n","path":"data/docs/finance/mortgage-options.md","anchors":[{"anchorId":"anc_1",' +
        '"threadId":"th_x9y8","threadStatus":"open","range":{"start":12,"end":45},' +
        '"orphaned":false,…}]}`.',
    },
  ],
  handler: (context) => runDocShow(context),
};
