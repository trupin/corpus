import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { documentLines } from "./render.js";

/**
 * `corpus doc show` — the CLI's first document *read* (SPEC.md §5, §7), and
 * **the read that hands out the key**. The agent interacts with the system only
 * through the CLI (CLAUDE.md Architecture Decision 2), and a document's state is
 * not fully recoverable from its file: anchors resolve against the *current*
 * body at read time, so whether a thread is still attached is something only
 * `GET /api/docs/{id}` can answer. Parsing the markdown would answer it wrongly
 * — and, since SHARED-041, could not answer at all, because the key names the
 * version the server just handed you.
 *
 * The verb is one request and a rendering. It prints the frontmatter a person
 * reads first, the key a writer presents back, the anchored threads with their
 * resolution state — the context §7's comment skill needs before replying — and
 * then the body. Everything the endpoint returns, including the view keys and
 * the plugin `extra` block, is in `--json`; the human rendering is a summary and
 * says so.
 *
 * Timestamps that the file genuinely lacks (a hand-written `SKILL.md` has none)
 * render as “—”, never as a substituted date: the contract prescribes it, and
 * "we do not know" is not "1970".
 */

export async function runDocShow(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");
  const doc = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id } } }),
  );

  context.out.emit(doc);
  for (const line of documentLines(doc)) context.out.line(line);
}

export const showCommand: WorkspaceCommandSpec = {
  name: "show",
  summary: "Read a document — and get the key that lets you write it back.",
  description:
    "Reads `GET /api/docs/{id}` and prints what the server returned — the CLI never opens the " +
    // `_current_` rather than `*current*`: Prettier normalises markdown emphasis
    // when it formats the generated `docs/cli.md`, and the drift check compares
    // the formatted file against this string.
    "file. That matters for anchors: they are resolved against the _current_ body at read time, " +
    "so each one is listed with the thread it belongs to, that thread's status, and either the " +
    "character range it landed on or the fact that it is orphaned (SPEC.md §6). A timestamp the " +
    "file does not carry renders as “—” rather than as an invented date.\n\n" +
    "**The third line is the document's `key`** (SPEC.md §7). It names the version this read " +
    "returned, and `corpus doc edit <id> --key <key>` is how you write a new body back: a write " +
    "that replaces the body without one is refused, and one presenting a key the document has " +
    "since moved past is refused with the document as it now stands and a fresh key (exit 9). " +
    "It is printed whole and is opaque — echo it back exactly, never compute, shorten or compare " +
    "parts of one. There is nothing to release: reading gives you a key, not a claim.\n\n" +
    "**When a person has an edit session open**, the read says so on its own line. That is " +
    "information, not a refusal — nothing is blocked, and a write would land — but the polite " +
    "move is to leave the document alone and come back, or to park the claimed work with " +
    "`corpus queue defer <event-id> --blocked-on <id>`, which returns to pending on its own when " +
    "the session ends.\n\n" +
    "The human rendering is a summary: the whole payload — including the §11 view keys and any " +
    "plugin `extra` — is what `--json` emits, unchanged. An id that names no document is the " +
    "server's `404`, which is exit 5.",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [],
  examples: [
    {
      command: "corpus doc show doc_a1b2c3",
      description:
        "Read a document before editing or commenting on it: header, its `key`, anchored threads, then the body.",
    },
    {
      command: "corpus doc show doc_a1b2c3 --json | jq -r .key",
      description:
        "The key on its own — the value `corpus doc edit <id> --key …` presents back when it replaces the body.",
    },
    {
      command: "corpus doc show doc_a1b2c3 --json",
      description:
        'One JSON value: `{"frontmatter":{"id":"doc_a1b2c3","type":"note","title":"Mortgage ' +
        'options","created":"2026-07-28T10:00:00.000Z","updated":null,…},"body":"30-year fixed at ' +
        '6.1%.\\n","path":"data/docs/finance/mortgage-options.md","key":"3b2ec1f0…","userEditing":' +
        'false,"anchors":[{"anchorId":"anc_1",' +
        '"threadId":"th_x9y8","threadStatus":"open","range":{"start":12,"end":45},' +
        '"orphaned":false,…}]}`.',
    },
  ],
  handler: (context) => runDocShow(context),
};
