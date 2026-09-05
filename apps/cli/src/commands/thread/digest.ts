import { DIGEST_MAX_CHARS } from "@corpus/contract";
import { UsageError } from "../../errors.js";
import {
  bodyFlags,
  BODY_SOURCES_HELP,
  resolveBody,
  warningSuffix,
  type InputDependencies,
} from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus thread digest set|clear` — the resident's rolling digest (SPEC.md §6,
 * rider signed 2026-09-05; CLI-077).
 *
 * One digest per thread, written by the thread's resident at reply time, through
 * this verb and nothing else: the server never generates, edits or repairs one,
 * because a summary nobody wrote is worse than none. The CLI's share is equally
 * narrow — it sends what it was given, byte for byte, and prints what the server
 * answered. It does not summarize, reflow or trim, and it never decides who may
 * write: §7 owns that, and the server's refusal is reported rather than
 * second-guessed.
 *
 * ## One verb, two actions, and why not two verbs
 *
 * The registry dispatches `corpus <topic> <verb>` and nothing deeper, so
 * `digest set` and `digest clear` are one verb with an `action` positional —
 * the command lines read exactly as the issue writes them, and the registry's
 * two-level shape stays the only shape there is. An action outside the pair is
 * a usage error naming both, with nothing sent.
 *
 * ## The body never travels through argv (CLI-074)
 *
 * A digest is multi-line prose written by a model, and CLI-074 measured what
 * happens when a value's own content reaches the shell: a person's pasted words
 * executed as commands. So `set` takes `-m`, `--file` or stdin — the three
 * forms `thread reply` offers, through the same `resolveBody` — and there is no
 * positional body and never will be.
 *
 * ## An empty body is refused here, with the repair named (CONTRACT-096)
 *
 * The contract refuses a blank `PUT` (`422`) because an empty write is not a
 * clear — a resident that meant to update a digest must never destroy it by
 * sending nothing. An exactly-empty body is the same answer one round trip
 * earlier, at exit 2, with the hint naming the verb that does clear
 * (`thread reply`'s posture on its own empty body). A whitespace-only body is
 * deliberately **not** judged here: the server owns what blank means, and its
 * `422` names the same remedy.
 *
 * ## The clear reports the post-state, not the act
 *
 * `DELETE` is idempotent and answers `digest: null` whether or not there was
 * anything to clear. `thread release` disambiguates its own no-op with a
 * pre-read — but that pre-read is `GET /api/threads/{id}`, the whole
 * conversation, and paying a 32KB read for a courtesy sentence on the surface
 * that exists to avoid 32KB reads would be this feature working against itself.
 * So the printed line states what is now true (`… carries no digest`) rather
 * than claiming a change that may not have happened.
 */

/** The digest's three read fields, structurally — the wire type satisfies it. */
export interface ThreadDigestLike {
  readonly body: string;
  readonly watermark: string;
  readonly stale: boolean;
}

/**
 * The invariant, stated once and embedded in the help of every surface that
 * prints a digest (`digest`, `thread show --index`, `thread context`). One
 * spelling on purpose: three paraphrases of a rule drift into three rules.
 */
export const DIGEST_ORIENTS_HELP =
  "**Summaries orient, they never act.** Before you quote a passage, patch a document, or " +
  "answer a question about what was said, read the turn verbatim — `corpus thread show <id> " +
  "--turn <n>`. The digest tells you _which_ turn; it is never the source of a quotation and " +
  "never the basis of a write.";

/**
 * The digest as the read surfaces print it: a header line carrying the
 * watermark, then the prose. Empty when there is no digest, because having none
 * is the ordinary state and not a value (SPEC.md §6).
 *
 * The header is what tells this block apart from everything below it — the rest
 * of an index is derived from `turns` and cannot be wrong, while this is written
 * prose that can be. A **stale** digest is never hidden and never replaced: the
 * body still prints, under a header that says a covered turn was deleted or
 * revised since, so the next reader knows to distrust it and the resident knows
 * to rewrite it.
 */
export function digestLines(digest: ThreadDigestLike | null | undefined): readonly string[] {
  if (digest === null || digest === undefined) return [];
  const header = digest.stale
    ? `digest · STALE — a turn at or before ${digest.watermark} was deleted or revised since ` +
      "this was written; it covers text that may no longer be there. Trust the turns, not this."
    : `digest · covers turns through ${digest.watermark}`;
  return [
    header,
    ...digest.body
      .trimEnd()
      .split("\n")
      .map((line) => line.trimEnd()),
  ];
}

const ACTIONS = ["set", "clear"] as const;
type DigestAction = (typeof ACTIONS)[number];

function digestAction(context: WorkspaceCommandContext): DigestAction {
  const action = context.args.get("action");
  if ((ACTIONS as readonly string[]).includes(action)) return action as DigestAction;
  throw new UsageError(`corpus thread digest does \`set\` or \`clear\`, got "${action}".`, {
    hint:
      "`set` writes the thread's digest — the body from -m, --file or stdin — and `clear` " +
      "removes it. Nothing was sent.",
  });
}

export async function runThreadDigest(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies = {},
): Promise<void> {
  const action = digestAction(context);
  const id = context.args.get("id");
  if (action === "clear") {
    await clearDigest(context, id);
    return;
  }
  await setDigest(context, id, dependencies);
}

/** A body flag beside `clear` is a caller that meant something else; ask, send nothing. */
function refuseBodyOnClear(context: WorkspaceCommandContext, id: string): void {
  const offered = ["message", "file"].find((flag) => context.flags.string(flag) !== undefined);
  if (offered === undefined) return;
  throw new UsageError(`--${offered} does not belong on a clear — clearing takes no body.`, {
    hint:
      `To replace the digest, write it: \`corpus thread digest set ${id} -m "…"\`. To remove ` +
      `it, drop --${offered}. Nothing was sent.`,
  });
}

async function clearDigest(context: WorkspaceCommandContext, id: string): Promise<void> {
  refuseBodyOnClear(context, id);
  const response = await context.client.request((api) =>
    api.DELETE("/api/threads/{id}/digest", { params: { path: { id } } }),
  );
  context.out.emit(response);
  context.out.line(`${id} now carries no digest${warningSuffix(response.warnings)}`);
}

async function setDigest(
  context: WorkspaceCommandContext,
  id: string,
  dependencies: InputDependencies,
): Promise<void> {
  const body = await resolveBody(context, dependencies, { what: "digest", mayBeOmitted: false });
  if (body === undefined || body === "") {
    throw new UsageError("no digest to send.", {
      hint:
        `Pass it with -m "…", with --file <path>, or pipe it in: \`… <<'CORPUS_EOF' … ` +
        `CORPUS_EOF\`. Always \`CORPUS_EOF\`, never \`EOF\`: text you are carrying can contain ` +
        `a line reading \`EOF\`, which ends the heredoc early and runs the rest as commands. ` +
        `An empty digest is not a clear — \`corpus thread digest clear ${id}\` removes one.`,
    });
  }

  const response = await context.client.request((api) =>
    api.PUT("/api/threads/{id}/digest", { params: { path: { id } }, body: { body } }),
  );

  context.out.emit(response);
  // The watermark is the one thing the writer cannot know — the server stamps
  // the newest turn's `ts` at the instant of the write — so the success line is
  // where the writer learns what its digest now claims to cover.
  const covered =
    response.digest === null ? "" : ` — covers turns through ${response.digest.watermark}`;
  context.out.line(`set digest of ${id}${covered}${warningSuffix(response.warnings)}`);
}

export const digestCommand: WorkspaceCommandSpec = {
  name: "digest",
  summary: "Write, or clear, the thread's rolling digest — the resident's account of it so far.",
  description:
    "A thread may carry one **digest**: a short prose account of the conversation so far, " +
    "written by the thread's **resident** at reply time and never by the server (SPEC.md §6, " +
    "rider signed 2026-09-05). It is what makes a restart affordable — a listener that has " +
    "never seen a long conversation reads the digest, then `corpus thread show <id> --index`, " +
    "then the few turns that matter, instead of every turn ever written — and its cost stays " +
    "roughly flat as the thread grows.\n\n" +
    `${DIGEST_ORIENTS_HELP}\n\n` +
    "**`set` writes it** — one per thread, replacing whatever was there. The body is sent " +
    "**byte for byte**: nothing is summarized, reflowed or trimmed here, and nothing refuses a " +
    "digest longer than the turns it covers — though at that length it has stopped being a " +
    "summary and is doing nobody's restart any favours. The server stamps the **watermark** " +
    "(the timestamp of the newest turn at the instant of the write — a writer cannot state one " +
    "honestly, so there is no flag for it) and clears any staleness, because the writer has " +
    "just read the turns. The printed line names the watermark, so you never re-read the " +
    "thread to learn what you just covered. Deleting or revising a covered turn later marks " +
    `the digest **stale** wherever it is shown; rewriting it is the only repair. At most ` +
    `${String(DIGEST_MAX_CHARS)} characters — longer is the server's \`400\` naming the ` +
    "field.\n\n" +
    "**`clear` removes it**, and is the only thing that does: an **empty** `set` is refused " +
    "(exit 2, nothing sent) rather than read as a clear, so a resident that meant to update a " +
    "digest can never destroy it by sending nothing. Clearing a thread that has no digest " +
    "changes nothing and exits 0 — no digest is the ordinary state, not a fault.\n\n" +
    "**Refusals the server owns, reported as it answers them (exit 5).** A thread with **no " +
    "resident** may not hold a digest at all (`422`): designate one first — " +
    "`corpus thread designate <id>` — and note that resolving a thread released its resident, " +
    "so a resolved thread's digest can be neither rewritten nor removed. A thread with **no " +
    "turns** has nothing for a watermark to name (`422`). An unknown thread is the `404` it " +
    "always is.\n\n" +
    BODY_SOURCES_HELP,
  args: [
    {
      name: "action",
      required: true,
      description: "`set` writes the digest; `clear` removes it. Anything else is exit 2.",
    },
    { name: "id", required: true, description: "The thread's id." },
  ],
  flags: [...bodyFlags("The digest")],
  examples: [
    {
      command:
        "corpus thread digest set th_a1b2c3 --from agent <<'CORPUS_EOF'\nDecided: 30-year fixed, 6.1% verified against the note (turn 7).\nOpen: whether to escrow taxes — user leaning yes (turn 16).\nCORPUS_EOF",
      description:
        "The resident's form, at reply time: a heredoc digest of what was decided and what is " +
        "still open, naming the turns to read verbatim.",
    },
    {
      command: "corpus thread digest set th_a1b2c3 --from agent --file digest.md --json",
      description:
        'One JSON value — `{"threadId":"th_a1b2c3","digest":{"body":"…","watermark":' +
        '"2026-09-04T10:00:00.000Z","stale":false},"warnings":[]}` — the watermark the server ' +
        "stamped, read back without re-reading the thread.",
    },
    {
      command: "corpus thread digest clear th_a1b2c3 --from agent",
      description:
        "Remove the digest outright — the explicit act an empty `set` is refused in favour of.",
    },
  ],
  handler: (context) => runThreadDigest(context),
};
