import { CommitShaSchema, DOC_DIFF_MAX_CHARS } from "@corpus/contract";
import type { paths } from "@corpus/contract/client";
import { UsageError } from "../../errors.js";
import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus doc diff` — the escalation a `doc.edited` event deliberately does not
 * carry (SPEC.md §4's edit-acknowledgment rider, `GET /api/docs/{id}/diff`).
 *
 * The event says *that* a user edit session ended, with its commit range and
 * three numbers; it never carries the diff body. The agent comes here on **every**
 * such event, because the numbers cannot tell a correction from a reversal —
 * `will` becomes `will not` at `+1 -1` exactly as a misspelling does. AGENT-011
 * drilled it: a substantive edit and a typo fix produced byte-identical payloads
 * (`1 commit, +2 -2`), so there is no stats-only skip and the skill fetches every
 * time. What the numbers are for is **sizing** the read, never deciding it. So the
 * reader of this output is a loop deciding whether to go looking at other
 * documents — not a person admiring a diff — and the rendering is built for that:
 *
 * 1. **the identity line** — id and path, because the next moves (`corpus search`,
 *    `corpus doc related`, `corpus doc show`) all take one of the two;
 * 2. **the range, alone on its line** — the two resolved shas exactly as the
 *    server used them, unabbreviated, so re-pinning the same range later is a
 *    copy rather than a lookup;
 * 3. **the counts, and the size** — how much changed across the whole range, and
 *    how much of the diff is actually below;
 * 4. **the diff**, verbatim;
 * 5. **the cut, when there was one**.
 *
 * **Truncation is said twice, in two different ways, and neither is decoration.**
 * The size on line 3 is a measurement in a fixed slot — `812 characters` when
 * whole, `showing 16000 of 61200 characters` when cut — so it is stated *before*
 * the body, where a reader that stops early still sees it. The `#` notice after
 * the body is stated *at the cut*, where the text stops, and says what not to
 * conclude from it. An agent that reasons about a change it only half saw is the
 * one failure this verb can cause, and one notice in one place is one skim away
 * from being missed.
 *
 * **Nothing here is a failure.** A range in which this document did not change
 * prints a sentence and exits 0; a document with no committed history — never
 * committed, or a workspace with no version control at all (SPEC.md §11) — prints
 * that and exits 0. Both are answers the agent will legitimately hit.
 *
 * The diff itself is passed through untouched. It is a diff of a markdown
 * document, so it contains markdown; re-wrapping, trimming or rendering it would
 * show the document instead of the change to it. Only the framing newline is
 * dropped, because the writer supplies one.
 */

/** The route's own query type, so a contract rename fails the build, not the request. */
type DocDiffQuery = NonNullable<paths["/api/docs/{id}/diff"]["get"]["parameters"]["query"]>;

/** The route's own response type, for the same reason. */
type DocDiffResult =
  paths["/api/docs/{id}/diff"]["get"]["responses"][200]["content"]["application/json"];

/**
 * **Not `--from` and `--to`**, and not by preference: `--from` is a _global_ flag
 * naming the acting party (`user|agent`), resolved by the dispatcher for every
 * verb and rejected by registry validation if a command redeclares it. A range
 * half spelled `--from` would be parsed as an actor and fail with "must be one of:
 * user, agent" — for a read that SPEC.md §9.2 says has no acting party at all.
 *
 * The suffix goes on **both** halves. `--to` is free, but an asymmetric
 * `--from-rev`/`--to` pair hides that the two are one range and invites the
 * `--to-rev` that would then be an unknown flag. With the suffix, the mapping
 * from a `doc.edited` payload is still positionally obvious — its `from` and `to`
 * are these two flags' values, verbatim, empty-tree sha included.
 */
const FROM_FLAG = "from-rev";
const TO_FLAG = "to-rev";

export async function runDocDiff(context: WorkspaceCommandContext): Promise<void> {
  const id = context.args.get("id");
  const from = revision(context, FROM_FLAG);
  const to = revision(context, TO_FLAG);

  const query: DocDiffQuery = {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };

  const result = await context.client.request((api) =>
    api.GET("/api/docs/{id}/diff", { params: { path: { id }, query } }),
  );

  context.out.emit(result);
  for (const line of render(result)) {
    context.out.line(line);
  }
}

/**
 * A range half, refused locally when it is not a sha at all.
 *
 * The check is the contract's own `CommitShaSchema`, so there is one spelling of
 * the rule rather than a local second opinion. It exists because of the rename
 * above: the server's `400` names `query.from`, and an agent that typed
 * `--from-rev` would be told about a parameter it never wrote. Refusing here
 * names the flag, costs no round trip, and is exactly what `resolveActor` does
 * with a misspelled actor.
 *
 * A well-formed sha this workspace does not contain still goes to the server —
 * only the workspace's history can answer that, and its `400` says so in words.
 */
function revision(context: WorkspaceCommandContext, flag: string): string | undefined {
  const value = context.flags.string(flag);
  if (value === undefined) return undefined;
  if (CommitShaSchema.safeParse(value).success) return value;

  throw new UsageError(`--${flag} must be a commit sha — got "${value}".`, {
    hint:
      "7–64 lowercase hex characters, abbreviated or full. Named revisions are not accepted; " +
      "the `from` and `to` a `doc.edited` event carries are shas and pass straight through.",
  });
}

/** The whole human rendering, as lines. */
function render(result: DocDiffResult): readonly string[] {
  const header = `${result.id} · ${result.path}`;

  // Both halves, not just `to`: the contract nulls them together, and reading
  // only one would let the other print as `null..9f1c2ab` if that ever changed.
  if (result.from === null || result.to === null) {
    return [header, "no committed history for this document — nothing to diff."];
  }

  const heading = [header, `${result.from}..${result.to}`, statsLine(result)];

  if (result.diff === "") return [...heading, "", "no change in this range."];
  return [...heading, "", ...diffLines(result.diff), ...cutNotice(result)];
}

/** What changed across the **whole** range, then how much of it is below. */
function statsLine(result: DocDiffResult): string {
  const { commits, insertions, deletions } = result.stats;
  return [
    plural(commits, "commit"),
    `+${String(insertions)} -${String(deletions)}`,
    size(result),
  ].join(" · ");
}

/**
 * The one slot that always states the size, so the truncated and whole cases are
 * read in the same place rather than by noticing an extra line.
 */
function size(result: DocDiffResult): string {
  if (!result.truncated) return plural(result.totalChars, "character");
  return `showing ${String(result.diff.length)} of ${String(result.totalChars)} characters`;
}

/**
 * The diff, byte for byte. Only the trailing newline the writer adds back is
 * dropped — `trimEnd` would eat a final context line for an empty line in the
 * document, which in a unified diff is a single space and not nothing.
 */
function diffLines(diff: string): readonly string[] {
  return diff.replace(/\n$/, "").split("\n");
}

/**
 * The cut, at the cut. It names what is missing in characters and says what not
 * to conclude — a diff that stops cleanly looks exactly like a diff that ended,
 * which is why the flag exists — then names the two escalations that exist: a
 * narrower range, or the document as it now stands.
 *
 * **It names no boundary, and that is the decision rather than an omission**
 * (CLI-028). It used to say "cut at a hunk boundary", which was true of the rule
 * of the day and false of the next one: CONTRACT-032 replaced hunk-dropping with
 * *the last line boundary at or before the bound*, and kept a fallback that cuts
 * mid-line for a single line longer than the whole cap. So no fixed adjective is
 * true of both shapes — and **nothing on the wire says which shape happened**.
 * `DocDiff` carries `diff`, `truncated` and `totalChars`, so a client that named
 * the boundary would be inferring the server's rule from a trailing byte and
 * printing the inference as a fact. That is the class of sentence this notice
 * exists to prevent, in the one place it can least afford to make it.
 *
 * What replaces it is not a vaguer adjective but the **measurement**: how far
 * short of the whole change this text stops. It is what the reader can act on, it
 * is already what the size line above the body states in its own form, and it
 * stays true however the cut is made. The boundary type was never actionable —
 * nothing in this repository applies the diff, and the escalations are the same
 * two whichever line the text ended on.
 */
function cutNotice(result: DocDiffResult): readonly string[] {
  if (!result.truncated) return [];
  const missing = result.totalChars - result.diff.length;
  return [
    "",
    `# the diff above was cut to fit the ${String(DOC_DIFF_MAX_CHARS)}-character bound: it stops ` +
      `${plural(missing, "character")} short of the whole change, and the counts above are for ` +
      "the whole range. Do not read it as the whole change — narrow the range with " +
      `--${FROM_FLAG}/--${TO_FLAG}, or read the document as it now stands with: corpus doc show ` +
      result.id,
  ];
}

export const diffCommand: WorkspaceCommandSpec = {
  name: "diff",
  summary: "Read what changed in a document across a commit range.",
  description:
    "Reads `GET /api/docs/{id}/diff` (SPEC.md §4, §9.2) and prints the document's id and path, the " +
    "revision range that was actually read, what changed in numbers, and the unified diff itself.\n\n" +
    "**This is the follow-up to a `doc.edited` event, and it is made on every one of them.** " +
    "That event announces that a user's edit session ended and carries the session's commit range " +
    "and its change stats — never the diff body. **The stats size this read, they never decide " +
    "it.** A substantive edit and a typo fix can produce the same numbers — `will` becomes `will " +
    "not` at `+1 -1` exactly as a misspelling does, and a drill produced two byte-identical " +
    "payloads (`1 commit, +2 -2`) for exactly that pair — so there is no stats-only skip, and the " +
    "diff is the only thing that says which change happened. The event's `from` and `to` are " +
    "passed through **verbatim** as " +
    `\`--${FROM_FLAG}\` and \`--${TO_FLAG}\`` +
    " — including the empty-tree sha an event carries for a document's **first** change, which " +
    "diffs as wholly added. That is any document's first commit, not only one made by the " +
    "repository's root commit, because both bases walk _this document's_ history rather than the " +
    "branch's. Nothing needs converting.\n\n" +
    "**Both halves are optional and default independently**: `to` to the newest commit that " +
    "touched this document, `from` to the newest commit **before `to` that touched this " +
    "document** — git's empty tree when nothing before it did. Deliberately **not `to`'s " +
    "parent**: §4's commit windows are party-scoped and gather a party's saves across documents, " +
    "so the parent of a window commit is routinely another party's save to a different file " +
    "rather than this document's previous state. Both bases would print the same bytes, since " +
    "every read here is path-scoped; only one of them is a true statement about where this " +
    "document came from, and `from` is printed back as a fact. So bare `corpus doc diff <id>` " +
    "reads as _what changed in this document's last commit_, and the two together read as _what " +
    "changed in that session_. The resolved shas are printed back on their own line, " +
    "unabbreviated, so the same range can be pinned again later.\n\n" +
    `**The diff is bounded and the cut is stated twice.** At most ${String(DOC_DIFF_MAX_CHARS)} ` +
    "characters come back, and a larger change is cut from the end rather than refused. The size " +
    "line always says how much of the diff is shown (`showing 16000 of 61200 characters`), and a " +
    "`#` notice after the body says the text was cut and how far short of the whole change it " +
    "stops. Neither names **where** the cut fell, deliberately: the rule is the server's and it " +
    "has already moved once, the response carries no field saying which cut happened, and what " +
    "the reader acts on is how much is missing rather than which line it ended on. Acting on half " +
    "a change while believing it whole is the one failure this verb can cause, so it is said " +
    "before the body and again where the body stops.\n\n" +
    "**Nothing normal here is an error.** A range in which this document did not change prints " +
    "one line and exits 0; a document with no committed history — never committed, or a workspace " +
    "with no version control (SPEC.md §11) — prints that and exits 0.\n\n" +
    `Revisions are commit shas only. A \`--${FROM_FLAG}\`/\`--${TO_FLAG}\` that is not a sha at ` +
    "all is a " +
    "usage error (exit 2) and no request is sent; a well-formed sha this workspace does not " +
    "contain is the server's `400` naming the parameter (exit 5). The `404` on this route means " +
    "the **document** is unknown, never the revision. `--json` emits the server's envelope " +
    "unchanged, whose `truncated` and `totalChars` are what a machine reader branches on.",
  args: [{ name: "id", required: true, description: "The document whose change to read." }],
  flags: [
    {
      name: FROM_FLAG,
      type: "string",
      valueName: "sha",
      description:
        `Base of the range, **exclusive**. Defaults to the newest commit before \`--${TO_FLAG}\` ` +
        "**that touched this document**, which reads as that one commit's own change to it; when " +
        "nothing before it ever touched this document the base is git's empty tree, so a " +
        "document's first change diffs as wholly added. Deliberately **not the head's parent** — " +
        "commit windows are party-scoped, so the parent of a window commit is routinely another " +
        "party's save to a different file rather than this document's previous state (SPEC.md " +
        "§4). Named revisions are rejected — a commit sha only, exactly as a `doc.edited` event " +
        "carries it. Spelled with the `-rev` suffix because `--from` is the global flag naming " +
        "the acting party.",
    },
    {
      name: TO_FLAG,
      type: "string",
      valueName: "sha",
      description:
        "Head of the range, **inclusive**. Defaults to the newest commit that touched this " +
        "document. A commit sha, like its base half.",
    },
  ],
  examples: [
    {
      command: "corpus doc diff doc_a1b2c3",
      description:
        "What changed in this document's last commit — the range the server picks when neither half is given.",
    },
    {
      command:
        "corpus doc diff doc_a1b2c3 --from-rev 0a1b2c3d4e5f6a7b8c9d --to-rev 9f1c2ab3d4e5f6071829",
      description:
        "The range from a `doc.edited` event, passed through unchanged: what that edit session did.",
    },
    {
      command: "corpus doc diff doc_a1b2c3 --json",
      description:
        'One JSON value: `{"id":"doc_a1b2c3","path":"data/docs/finance/mortgage-options.md",' +
        '"from":"0a1b2c3d4e5f6a7b8c9d","to":"9f1c2ab3d4e5f6071829","stats":{"commits":1,' +
        '"insertions":12,"deletions":3},"diff":"@@ -1,3 +1,12 @@\\n…","truncated":false,' +
        '"totalChars":812}`.',
    },
  ],
  handler: (context) => runDocDiff(context),
};
