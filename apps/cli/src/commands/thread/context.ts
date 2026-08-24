import {
  CONTEXT_MAX_EXCERPT_CHARS,
  CONTEXT_MAX_EXCERPTS,
  CONTEXT_MAX_SECTION_CHARS,
} from "@corpus/contract";
import type { paths } from "@corpus/contract/client";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { oneLine, renderColumns } from "../columns.js";
import { neighbourExclusionNote, semanticIndexNote } from "../retrieval.js";

/**
 * `corpus thread context` — the **briefing** SPEC.md §7 gives the comment skill
 * to start from (Retrieval Phase C, `GET /api/threads/:id/context`).
 *
 * Before it existed, an agent woken by a comment had to reconstruct what the
 * conversation was about: read the thread, read the whole parent document to
 * find the anchored passage inside it, then search around for anything related.
 * Three reads and a query, most of it thrown away. The pack answers all of that
 * in one call, and — this is the part that matters as the corpus grows — it is
 * **bounded**: the contract caps the parent-side prose, each excerpt and how
 * many there are, so reading a briefing costs about the same at fifty documents
 * and at fifty thousand.
 *
 * **The rendering is the reading order**, top-down, because that is how the
 * agent consumes it:
 *
 * 1. the parent block — what the conversation is *about*, in whichever of the
 *    five shapes the thread has;
 * 2. the truncation line, when the parent-side prose was cut, naming the
 *    escalation (`corpus doc show`) rather than leaving the agent to edit
 *    against text it believes is whole;
 * 3. the related excerpts, one per line, ranked — addresses to read next, never
 *    bodies;
 * 4. the degraded-ranking note last, when the server flags one.
 *
 * **Five shapes, and each says what it is** (sprint-022 C1): the pack's `shape`
 * field decides what the parent block can contain, so this verb switches on it
 * exactly once and never probes for a present-but-empty object. A standalone
 * thread prints no parent block at all — not an empty heading for one — because
 * there is no parent content, and an orphaned anchor or a deleted parent says so
 * in a sentence rather than leaving an absence to be interpreted.
 *
 * **No formatter was invented for the excerpt lines** (sprint-022 C9 / Open
 * Conflict 5). They go through `renderColumns` and `oneLine`, the same two
 * helpers `corpus search` and `corpus doc related` use, in this surface's own
 * four-column order — id, heading path, relation, excerpt — with the free text
 * last, since `renderColumns` deliberately leaves the last column ragged.
 * Unifying the three verbs behind one hit-line formatter would have changed
 * `search`'s output, which the product's own skills paste verbatim.
 */

/** The route's own response type, so a contract rename fails the build, not the render. */
type ContextPack =
  paths["/api/threads/{id}/context"]["get"]["responses"][200]["content"]["application/json"];

/** What an absent value renders as, matching `corpus thread show` and `corpus doc show`. */
const NONE = "—";

export async function runThreadContext(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");

  const pack = await context.client.request((api) =>
    api.GET("/api/threads/{id}/context", { params: { path: { id } } }),
  );

  context.out.emit(pack);

  for (const line of briefing(pack)) {
    context.out.line(line);
  }
}

/** The whole human rendering, as lines: parent, then excerpts, then the note. */
function briefing(pack: ContextPack): readonly string[] {
  const note = semanticIndexNote(pack.semanticIndex);

  return joinBlocks(
    parentBlock(pack),
    excerptBlock(pack.excerpts),
    note === undefined ? [] : [note],
  );
}

/**
 * What the conversation is about — one block per shape, and the two shapes with
 * no parent content say why instead of printing a hole.
 */
function parentBlock(pack: ContextPack): readonly string[] {
  switch (pack.shape) {
    case "anchored":
      return joinBlocks(
        [
          `parent ${pack.parent.id} · ${orNone(pack.parent.title)} · ${orNone(oneLine(pack.parent.headingPath))}`,
        ],
        quoteLines(pack.parent.quote),
        proseLines(pack.parent.section),
        truncationLines(pack.parent.truncated, pack.parent.id),
      );
    case "whole-document":
      return joinBlocks(
        [`parent ${pack.parent.id} · ${orNone(pack.parent.title)}`],
        proseLines(pack.parent.opening),
        truncationLines(pack.parent.truncated, pack.parent.id),
      );
    case "orphaned-anchor": {
      // Branch on the *rendered* quote rather than the raw string: `quoteLines`
      // is what decides whether anything is printed, so the sentence and the
      // block below it can never disagree about whether there is a quote.
      const preserved = quoteLines(pack.parent.quote);
      return joinBlocks(
        [`parent ${pack.parent.id} · ${orNone(pack.parent.title)}`, orphanLine(preserved)],
        preserved,
        truncationLines(pack.parent.truncated, pack.parent.id),
      );
    }
    case "parent-deleted":
      return [
        `parent ${pack.deletedParent} was deleted; this conversation outlived it, so there is no ` +
          "parent content to show (SPEC.md §9.2).",
      ];
    case "standalone":
      // No parent, therefore no parent block: SPEC.md §7's "a standalone thread
      // has no parent content" is the absence itself, not a line about it.
      return [];
  }
}

/** One line per excerpt, or the one honest line when nothing relates. */
function excerptBlock(excerpts: ContextPack["excerpts"]): readonly string[] {
  if (excerpts.length === 0) return ["no related excerpts."];

  // The `#` marker is the CLI's meta channel (see `semanticIndexNote`): it tells
  // a reader — human or agent — where the parent's prose stops and the
  // positional rows start, which is the one ambiguity a briefing has that a flat
  // result list does not.
  return [
    "# related excerpts",
    ...renderColumns(
      excerpts.map((excerpt) => [
        excerpt.id,
        orNone(oneLine(excerpt.headingPath)),
        // Not passed through `oneLine`: `relation` is a closed enum, and
        // collapsing whitespace in a value that has none is a lie about where
        // the value came from (`doc/related.ts`'s rule).
        excerpt.relation,
        oneLine(excerpt.excerpt),
      ]),
    ),
  ];
}

/**
 * Why an orphan has no passage — and, when the quote is gone too, why it has no
 * quote either.
 *
 * The server returns `quote: ""` when neither the parent's frontmatter selector
 * nor the projection's anchor row survived (`threads/context.ts#readAnchor`),
 * which is a real state and not an error. Ending the sentence in a colon in
 * front of that absence would promise text the pack never prints, so the two
 * states get two sentences: one points at a block, the other states the loss.
 */
function orphanLine(preserved: readonly string[]): string {
  if (preserved.length === 0) {
    return (
      "the anchor no longer resolves in the parent (SPEC.md §6), and the quote the thread was " +
      "opened on was not preserved either, so the original text cannot be recovered and is not " +
      "guessed at."
    );
  }
  return (
    "the anchor no longer resolves in the parent (SPEC.md §6); the quote the thread was opened " +
    "on is preserved below, and where that text went is not guessed at:"
  );
}

/** The anchor's text, as a quote — multi-line selections included. */
function quoteLines(quote: string): readonly string[] {
  const trimmed = quote.trimEnd();
  if (trimmed.trim() === "") return [];
  return trimmed.split("\n").map((line) => (line.trim() === "" ? ">" : `> ${line.trimEnd()}`));
}

/** Parent-side prose (a section, or a document's opening) as it stands on disk. */
function proseLines(prose: string): readonly string[] {
  const trimmed = prose.trimEnd();
  if (trimmed.trim() === "") return [];
  return trimmed.split("\n").map((line) => line.trimEnd());
}

/**
 * The cut, stated. The contract makes `truncated` required precisely so silence
 * is never the answer, and the only useful thing to say about a cut is what to
 * run to see the rest.
 */
function truncationLines(truncated: boolean, parentId: string): readonly string[] {
  if (!truncated) return [];
  return [
    "# the parent text above was cut to fit the pack's bounds — read all of it with: " +
      `corpus doc show ${parentId}`,
  ];
}

/** Blocks separated by one blank line, empty blocks contributing nothing. */
function joinBlocks(...blocks: readonly (readonly string[])[]): readonly string[] {
  return blocks
    .filter((block) => block.length > 0)
    .flatMap((block, index) => (index === 0 ? block : ["", ...block]));
}

function orNone(text: string): string {
  return text === "" ? NONE : text;
}

export const contextCommand: WorkspaceCommandSpec = {
  name: "context",
  summary: "Brief yourself on a conversation: what it is about, and what else bears on it.",
  description:
    "Reads `GET /api/threads/{id}/context` (SPEC.md §7 Retrieval discipline, §9.2) and prints the " +
    "thread's **context pack** in the order an agent reads it: what the conversation is about, " +
    "then the most-related excerpts from elsewhere in the corpus, then a note if ranking was " +
    "degraded.\n\n" +
    "**This is where the comment skill starts.** One call replaces reading the thread, then the " +
    "whole parent document to find the anchored passage inside it, then searching for whatever " +
    "else bears on it. And it stays affordable: the pack is bounded by contract — at most " +
    `${String(CONTEXT_MAX_EXCERPTS)} excerpts, ${String(CONTEXT_MAX_EXCERPT_CHARS)} characters ` +
    `each, ${String(CONTEXT_MAX_SECTION_CHARS)} characters of parent-side prose — so reading a ` +
    "briefing costs roughly the same however large the corpus grows. There are no flags beyond " +
    "`--json`: the bounds live in the contract, so there is no way to ask this verb for the dump " +
    "it exists to refuse.\n\n" +
    "**The parent block takes the shape the thread has.** A thread anchored to a selection shows " +
    "the parent's id, title and heading path, the quote itself, and the **whole enclosing " +
    "section** around it — a comment on one sentence is rarely answerable from that sentence. A " +
    "whole-document thread shows the parent's title and its opening content. A thread whose " +
    "anchor no longer resolves (SPEC.md §6) says so and prints the preserved quote, with no " +
    "invented passage — and when the quote did not survive either, it says the original text " +
    "cannot be recovered rather than promising one. A thread whose parent was deleted says that " +
    "too, and still gets its " +
    "excerpts — it is a `200`, never a `404`, because the conversation plainly exists. A " +
    "standalone thread has no parent content, so it prints no parent block at all and goes " +
    "straight to the excerpts.\n\n" +
    "When the parent-side prose was cut to fit, a `#` line says so and names the escalation — " +
    "`corpus doc show <parent>`. Nothing is ever silently trimmed: an agent editing a section " +
    "must know whether it saw all of it.\n\n" +
    `${neighbourExclusionNote("corpus thread context")} A thread whose _parent_ is one of these ` +
    "types still gets that parent's block: the conversation is on it, and a parent is read by id " +
    "rather than through the candidate query.\n\n" +
    "Each excerpt is one padded line — id, heading path, relation, excerpt — and **never a " +
    "body**. Reading one is a separate, deliberate `corpus doc show <id>` on that row's id, " +
    "exactly as with `corpus search` and `corpus doc related`. A pack with nothing related is a " +
    "single honest line and exit 0. `--json` emits the server's envelope unchanged, whose " +
    "`shape` field is the one thing a machine reader switches on. A thread id that names " +
    "nothing is the server's `404`, which is exit 5.",
  args: [{ name: "id", required: true, description: "The thread to brief yourself on." }],
  flags: [],
  examples: [
    {
      command: "corpus thread context th_a1b2c3",
      description:
        "The briefing for an anchored thread: the parent, the quote, its whole section, then one line per related excerpt.",
    },
    {
      command: "corpus thread context th_a1b2c3 --json",
      description:
        'One JSON value: `{"shape":"anchored","threadId":"th_a1b2c3","parent":{"id":"doc_a1b2c3",' +
        '"title":"Mortgage options","headingPath":"Mortgage options › Escrow","quote":"recalculated ' +
        'annually","section":"## Escrow\\n\\nThe escrow reserve is recalculated annually.",' +
        '"truncated":false},"excerpts":[{"id":"doc_zz","headingPath":"Impound account true-up",' +
        '"excerpt":"The lender re-runs the impound analysis every twelve months.",' +
        '"relation":"similar"}],"semanticIndex":"current"}`.',
    },
  ],
  handler: (context) => runThreadContext(context),
};
