import {
  PatchDocRequestSchema,
  PATCH_REFUSAL_REASONS,
  type PatchDocRequest,
  type PatchRefusalReason,
} from "@corpus/contract";
import { z } from "zod";
import { PatchRefusedError, ServerResponseError, UsageError } from "../../errors.js";
import {
  plural,
  readAll,
  readFlagFile,
  stdinCarriesABody,
  stdinStream,
  warningSuffix,
  type InputDependencies,
  JOB_FLAG,
  resolveJob,
} from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { describeAnchors } from "./edit.js";
import { keyLine } from "./render.js";

/**
 * `corpus doc patch` — the edit that costs the change instead of the document
 * (SPEC.md §9.2, rider signed 2026-08-12).
 *
 * The write path's unit was the whole body, which priced a one-line correction at
 * the length of the file: read it, send it all back. This verb names the text it
 * expects to find and what to put there, so a bounded change costs the bounded
 * amount — and, because it never carries the rest of the body, it cannot destroy
 * the rest of the body. It is what the agent's skills reach for whenever the edit
 * is bounded; `corpus doc edit` stays the verb for rewriting a document
 * wholesale.
 *
 * Thin, like every verb: no local matching and no pre-flight scan of the body.
 * The server owns the semantics — one left-to-right non-overlapping scan that
 * both counts the matches and chooses the sites — and a CLI that counted for
 * itself would be a second implementation to drift from it.
 *
 * ## No `--key`, and that is not an omission
 *
 * SPEC.md §7 exempts a patch from presenting a key: it names the text it expects
 * to find, which is a staleness check by another route — but it covers what the
 * patch quotes and nothing else, so it is not the key by another name. A patch
 * replaces, so it catches a writer who changed the quoted text and not one who
 * inserted elsewhere. The contract is
 * strict and has no `key` field, so there is no flag to add — and if a
 * `stale_key` ever does come back from this route it means something *outside*
 * Corpus wrote the file between the server's match and its save. That is a
 * different fact with a different recovery, and it stays reported as itself
 * (exit 9) rather than folded into a patch refusal.
 */

/** Every flag that supplies part of the request; `--stdin` supplies all of them at once. */
const REQUEST_FLAGS = ["old", "new", "old-file", "new-file", "all"] as const;

/**
 * The two refusals, told apart.
 *
 * They share an exit code and differ in everything a caller does next, so each
 * one names its count and then says the *one* move that fixes it. Collapsing them
 * into "the patch did not apply" is the failure SPEC.md §9.2 legislates against:
 * an agent that cannot tell "look again" from "quote more" guesses, and both
 * guesses cost a round trip that teaches it nothing.
 *
 * The wording is the CLI's own rather than the server's, which is exactly why
 * `reason` and `matches` are machine-readable fields on the wire. The server can
 * only name routes and JSON keys — `send \`all: true\``, `PUT /api/docs/{id}` —
 * and the agent this CLI exists for issues no HTTP requests: it reads an error
 * message as an instruction, so the instruction has to be a command line.
 */
export function refusalText(
  reason: PatchRefusalReason,
  matches: number,
  id: string,
): { readonly message: string; readonly hint: string } {
  if (reason === "no-match") {
    return {
      message: `the text --old quotes is not in the body of ${id} — it matched 0 times, so nothing was written.`,
      hint:
        `Re-read the document — \`corpus doc show ${id}\` — and quote from what it says now. ` +
        `Matching is byte-exact: whitespace, indentation and line breaks all count, and the ` +
        `frontmatter block is not part of the body. If the excerpt spans lines, --old-file or ` +
        `--stdin carry it without the shell in the way.`,
    };
  }
  return {
    message: `the text --old quotes occurs ${String(matches)} times in the body of ${id} and this patch did not pass --all, so nothing was written.`,
    hint:
      `Quote more of the surrounding text until the excerpt occurs exactly once — the line above ` +
      `it is usually enough — or pass --all to replace all ${String(matches)} of them if that is ` +
      `what you meant. \`corpus doc show ${id}\` prints the body to quote from.`,
  };
}

/**
 * The shape of the `409` body this route refuses with, checked before it is
 * believed. It is narrower than the contract's `PatchConflictError` on purpose:
 * these are the three fields the classification turns on, and a `409` from any
 * other route — a taken skill name, a re-attach whose range moved — simply fails
 * to match and keeps its own classification.
 */
const PatchConflictBodySchema = z.object({
  code: z.literal("conflict"),
  reason: z.enum([...PATCH_REFUSAL_REASONS]),
  matches: z.number().int().min(0),
});

/**
 * A `409` from this route turned into the refusal it is, or `undefined` for every
 * other failure — a `404` for an unknown id, an unreachable server, and a
 * `stale_key`, which arrives already classified as exit 9 and must stay that way:
 * an external editor moved the file, and telling the caller to re-quote would
 * send it looking for a mistake it did not make.
 */
export function patchRefusal(cause: unknown, id: string): PatchRefusedError | undefined {
  if (!(cause instanceof ServerResponseError) || cause.status !== 409) return undefined;

  const parsed = PatchConflictBodySchema.safeParse(cause.details);
  if (!parsed.success) return undefined;

  const { reason, matches } = parsed.data;
  const { message, hint } = refusalText(reason, matches, id);
  return new PatchRefusedError(message, {
    status: cause.status,
    code: reason === "no-match" ? "patch_no_match" : "patch_multiple_matches",
    hint,
    // The count as a number, beside the reason, so a `--json` caller branches on
    // `.error.details.reason` and reads `.error.details.matches` — never parses
    // either back out of the sentence above.
    details: { reason, matches },
    // Deliberately **nothing** in human mode. `details` is normally dumped as
    // JSON under the message, and here that dump would repeat, in a shape no one
    // asked for, the two facts the message and its hint have already said in
    // English. An empty pre-rendered form is how this file says "the prose is
    // the human rendering"; `--json` is untouched and still carries the fields.
    detailLines: [],
    cause,
  });
}

/**
 * Where `old` and `new` come from, and why there are three routes rather than
 * one.
 *
 * A patch carries **two** pieces of text where every other write carries one, and
 * both are routinely multi-line — quoting a few lines with their context is the
 * normal way to make an excerpt unique. `resolveBody`'s trio (`-m` literal,
 * `--file`, stdin) is this CLI's answer for one value; this is the same trio
 * arranged for two:
 *
 * - **`--old` / `--new`** — the literal form, and the one every example uses. A
 *   shell's single quotes span lines and change nothing inside them, so the
 *   ordinary bounded edit is one readable command.
 * - **`--old-file` / `--new-file`** — the file form, exactly `doc edit --file`.
 *   The only route with no escaping anywhere: text carrying quotes, backticks,
 *   `$(…)` and blank lines reaches the server byte-for-byte as the file holds it.
 * - **`--stdin`** — the request itself, as JSON, on stdin. It is the whole
 *   request rather than a third spelling of one field, which is why it is parsed
 *   with the contract's own `PatchDocRequestSchema`, carries its own `all`, and
 *   takes no other patch flag. A heredoc is how it gets written.
 *
 * **Naming two sources for one side is refused, not silently resolved.**
 * `resolveBody` documents a precedence (`-m` beats `--file` beats stdin) because
 * it has one value and one mistake available. Here there are two values with two
 * sources each, and a precedence table nobody remembers would mean an ignored
 * `--old-file` patching somewhere the caller never quoted. One usage error with
 * nothing sent is cheaper than one edit in the wrong place.
 *
 * **A trailing newline is text.** A file and a heredoc both end with one and the
 * excerpt they are matched against may not, so a patch that "obviously" applies
 * can be refused over a newline. That is what the zero-match hint says, and it is
 * the price of byte-exactness being the property that makes a patch safe.
 */
export async function resolvePatchRequest(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies = {},
): Promise<PatchDocRequest> {
  if (context.flags.boolean("stdin")) return readStdinRequest(context, dependencies);

  const old = await resolveSide(context, "old", dependencies);
  const replacement = await resolveSide(context, "new", dependencies);

  if (old === undefined) {
    throw new UsageError("corpus doc patch needs the text it should replace.", {
      hint:
        "Pass it with --old '<excerpt>', with --old-file <path>, or send the whole request as " +
        "JSON on stdin with --stdin. Quote it exactly as `corpus doc show <id>` printed it — " +
        "matching is byte-exact. Nothing was sent to the server.",
    });
  }
  if (old === "") {
    throw new UsageError("--old is empty, and replacing nothing is not an edit.", {
      hint:
        "A patch anchors on the text it expects to find, so --old has to name some. To delete " +
        "text, quote it in --old and pass an empty --new. Nothing was sent to the server.",
    });
  }
  // Absence and emptiness stay distinguishable all the way down to this check,
  // because an empty `new` is the spelling of a deletion: inferring one from a
  // missing flag would turn "I forgot the replacement" into a silent deletion,
  // which is the one mistake this verb must not make cheap.
  if (replacement === undefined) {
    throw new UsageError("corpus doc patch needs the text to put in --old's place.", {
      hint:
        "Pass --new '<replacement>' or --new-file <path>. To delete the quoted text, say so " +
        "explicitly with an empty replacement: --new ''. Nothing was sent to the server.",
    });
  }

  return {
    old,
    new: replacement,
    // Omitted rather than sent as `false`: the server applies the default, and
    // the contract asks callers not to spell it out.
    ...(context.flags.boolean("all") ? { all: true } : {}),
  };
}

/** One side's text, from its literal flag or its file flag — never from both. */
async function resolveSide(
  context: WorkspaceCommandContext,
  side: "old" | "new",
  dependencies: InputDependencies,
): Promise<string | undefined> {
  const literal = context.flags.string(side);
  const file = context.flags.string(`${side}-file`);

  if (literal !== undefined && file !== undefined) {
    throw new UsageError(`--${side} and --${side}-file both name the ${side} text.`, {
      hint:
        "Use one of them. Neither wins over the other here, deliberately: with two texts to " +
        "supply, a silently ignored source would patch somewhere you did not quote. Nothing was " +
        "sent to the server.",
    });
  }
  if (file === undefined) return literal;
  return readFlagFile(context, `${side}-file`, file, dependencies);
}

/**
 * The request as JSON on stdin, parsed with the contract's own request schema —
 * the CLI declares no second shape for a body the contract already owns
 * (`docs/TS_GUIDELINES.md`, trust boundaries). Strictness comes with it, and it
 * matters here: the three field names are short common words, and an unknown key
 * quietly dropped would mean performing a different edit from the one asked for
 * — a `replace` ignored is a `new` of `""`, which is a deletion.
 */
async function readStdinRequest(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies,
): Promise<PatchDocRequest> {
  const conflicting = REQUEST_FLAGS.filter((flag) =>
    flag === "all" ? context.flags.boolean(flag) : context.flags.string(flag) !== undefined,
  );
  if (conflicting.length > 0) {
    const named = conflicting.map((flag) => `--${flag}`).join(", ");
    throw new UsageError(`--stdin is the whole patch request, so it takes no ${named}.`, {
      hint:
        'The JSON document carries every field: {"old": …, "new": …, "all": true}. Drop --stdin ' +
        "to use the flags instead. Nothing was sent to the server.",
    });
  }

  // The `fstat` probe, never `!isTTY`: an agent harness leaves a socket on fd 0
  // that is never written to and never closed, and a verb that read it would park
  // the agent forever (CLI-007). `--stdin` with nothing piped is a usage error,
  // not a wait.
  if (!(dependencies.stdinIsBodySource ?? stdinCarriesABody())) {
    throw new UsageError("--stdin was given but nothing is piped in.", {
      hint:
        "Send the request as a heredoc: `corpus doc patch <id> --stdin <<'CORPUS_EOF'`, then the JSON, " +
        "then `CORPUS_EOF`. Nothing was sent to the server.",
    });
  }

  return parseStdinRequest(await readAll(dependencies.stdin ?? stdinStream()));
}

export function parseStdinRequest(text: string): PatchDocRequest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new UsageError("the --stdin patch request is not valid JSON.", {
      hint:
        'It is one JSON object: {"old": "…", "new": "…"}. Newlines inside the strings are \\n, ' +
        "so when that escaping is the awkward part, --old-file and --new-file need none. " +
        "Nothing was sent to the server.",
      cause,
    });
  }

  const parsed = PatchDocRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new UsageError(`the --stdin patch request is not a patch: ${issues(parsed.error)}.`, {
      hint:
        'The document is {"old": "<excerpt>", "new": "<replacement>"}, plus an optional ' +
        '"all": true. `old` must be non-empty; `new` may be "", which is how a deletion is ' +
        "spelled. Nothing was sent to the server.",
    });
  }
  return parsed.data;
}

/**
 * Zod's report as one line. Typed structurally rather than as a `ZodError`
 * because the schema comes from the contract's zod instance and the summary is
 * built here: the shape is what both agree on.
 */
function issues(error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join(".");
      return path === "" ? issue.message : `${path}: ${issue.message}`;
    })
    .join("; ");
}

async function sendPatch(
  context: WorkspaceCommandContext,
  id: string,
  request: PatchDocRequest,
): ReturnType<typeof postPatch> {
  try {
    return await postPatch(context, id, request, resolveJob(context.flags, context.env));
  } catch (error) {
    const refusal = patchRefusal(error, id);
    if (refusal !== undefined) throw refusal;
    throw error;
  }
}

function postPatch(
  context: WorkspaceCommandContext,
  id: string,
  request: PatchDocRequest,
  job: string | undefined,
) {
  return context.client.request((api) =>
    api.POST("/api/docs/{id}/patch", {
      params: { path: { id } },
      // Rebuilt field by field rather than spread whole: the generated request
      // type uses exact optional properties, so an `all` that is present and
      // `undefined` is not the same as an absent one — and absent is what the
      // contract asks for when the caller did not opt in.
      body: {
        old: request.old,
        new: request.new,
        // SPEC.md §9.2: the work this write serves (CLI-044).
        ...(job === undefined ? {} : { job }),
        ...(request.all === undefined ? {} : { all: request.all }),
      },
    }),
  );
}

export async function runDocPatch(
  context: WorkspaceCommandContext,
  dependencies: InputDependencies = {},
): Promise<void> {
  const id = context.args.get("id");
  const request = await resolvePatchRequest(context, dependencies);
  const response = await sendPatch(context, id, request);

  context.out.emit(response);
  context.out.line(
    `${outcome(id, request, response.replaced)}${describeAnchors(response.anchors, response.doc)}${warningSuffix(response.warnings)}`,
  );
  // The fresh key, exactly as `doc edit` prints it: a patch is an ordinary write
  // once applied, so it hands out the next one like any other write does.
  context.out.line(keyLine(response.doc));
}

/**
 * The success line — and the one success that is not a change.
 *
 * SPEC.md §9.2: a patch whose result is the unchanged body writes nothing and is
 * still answered normally, because a caller asking for a change already present
 * has got what it asked for. The CLI can see that case in the request it just
 * sent (`new` equal to `old`), and says so rather than reporting an edit that
 * made no commit: an agent told "patched" would go looking for a diff that does
 * not exist, and a chain of no-ops reported as edits is how a loop convinces
 * itself it is making progress.
 */
export function outcome(id: string, request: PatchDocRequest, replaced: number): string {
  const occurrences = plural(replaced, "occurrence");
  if (request.new === request.old) {
    return (
      `${id} unchanged — --new is the text --old quotes, so the ${occurrences} it matched ` +
      `already said that and nothing was written`
    );
  }
  return `patched ${id} — ${occurrences} replaced`;
}

export const patchCommand: WorkspaceCommandSpec = {
  name: "patch",
  summary: "Replace an exact excerpt of a document's body, without sending the whole body.",
  description:
    "**The verb to reach for when you can quote the change.** `corpus doc edit` sends a whole " +
    "body, which prices a one-line correction at the length of the document — read it, send it " +
    "all back. A patch names the text it expects to find and what to put in its place, so it " +
    "costs the change instead; and because it never carries the rest of the body, it cannot lose " +
    "the rest of the body to a stale read or to a marker the writer did not understand.\n\n" +
    "`--old` must match the body **exactly and once**. Matching is byte-exact against the body " +
    "as `corpus doc show <id>` printed it: no trimming, no whitespace collapsing, no case " +
    "folding, no regular expressions — quote what you read. The body is the markdown **without " +
    "the frontmatter block**, so an excerpt quoting frontmatter matches nothing; frontmatter is " +
    "changed by naming its fields on `corpus doc edit`.\n\n" +
    "**The two refusals are different problems, and each says which it is** (exit 10, nothing " +
    "written). Matching **0 times** means the text is not there: re-read the document, because " +
    "it is not what you last read or the excerpt was never in the body. Matching **more than " +
    "once** means the excerpt is ambiguous: quote more of the surrounding text until it is " +
    "unique, or pass `--all` and mean it. Both name the count.\n\n" +
    "`--new ''` **deletes** the quoted text — that is how a deletion is spelled, and it is not " +
    "an error. `--new` equal to `--old` is a no-op: it is answered normally, nothing is written " +
    "and no commit is made, and the output says so rather than claiming an edit.\n\n" +
    "**There is no `--key`** (SPEC.md §7). A patch names the text it expects to find, which is " +
    "a staleness check by another route, and a sharper one where it applies: it says _which_ text " +
    "is gone rather than _that_ the document changed. **It covers what you quoted and nothing " +
    "else**, though — a patch replaces, so it catches a writer who changed your excerpt and not " +
    "one who inserted elsewhere. An append that another writer may also be appending to goes " +
    "back whole under a key instead. Everything else about a patch is an " +
    "ordinary write: it is validated before it lands (SPEC.md §14), anchors are reconciled with " +
    "remaps and orphans reported (SPEC.md §6), the change is committed and attributed to `--from` — " +
    "folded into the open commit window like any other save, not necessarily a commit of its own (§4) — and " +
    "the fresh key is printed on the line after the confirmation.\n\n" +
    "**Three ways to supply the text**, because both halves are routinely multi-line. `--old` " +
    "and `--new` are the literal form and the one to use by default — a shell's single quotes " +
    "span lines. `--old-file` and `--new-file` read a file verbatim and are the route with no " +
    "escaping anywhere. `--stdin` takes the whole request as one JSON object, and therefore " +
    "takes no other patch flag. Naming two sources for the same side is a usage error rather " +
    "than a silent precedence: an ignored source would patch text you never quoted. Note that a " +
    "file and a heredoc both end in a newline and a newline is text like any other — an excerpt " +
    "that should obviously match and reports 0 matches is usually one trailing newline long.",
  args: [{ name: "id", required: true, description: "The document's id." }],
  flags: [
    {
      name: "old",
      type: "string",
      valueName: "text",
      description:
        "The excerpt to replace, quoted **exactly** as the body holds it — the same bytes " +
        "`corpus doc show <id>` printed. Whitespace and indentation are significant. It must " +
        "occur exactly once unless `--all` is passed; anything else is refused with exit 10, " +
        "naming the count. Cannot be combined with `--old-file`.",
    },
    {
      name: "new",
      type: "string",
      valueName: "text",
      description:
        "What to put in `--old`'s place. **Required, and may be empty**: `--new ''` deletes the " +
        "quoted text, which is why an omitted flag is a usage error rather than a deletion. " +
        "Equal to `--old` it is a no-op — answered normally, nothing written, no commit. Cannot " +
        "be combined with `--new-file`.",
    },
    {
      name: "old-file",
      type: "string",
      valueName: "path",
      description:
        "Read the excerpt from this file, byte for byte — the route with no shell quoting and " +
        "no JSON escaping in it at all. The file is only read. Its trailing newline is part of " +
        "the excerpt.",
    },
    {
      name: "new-file",
      type: "string",
      valueName: "path",
      description:
        "Read the replacement from this file, byte for byte. The file is only read, and its " +
        "trailing newline is part of the replacement.",
    },
    {
      name: "stdin",
      type: "boolean",
      description:
        'Read the whole request from stdin as one JSON object — `{"old": "…", "new": "…"}`, ' +
        'optionally with `"all": true`. It is the request rather than a third spelling of one ' +
        "field, so it takes no other patch flag. Newlines inside the strings are `\\n`; when " +
        "that escaping is the awkward part, `--old-file` and `--new-file` need none.",
    },
    {
      name: "all",
      type: "boolean",
      description:
        "Replace **every** occurrence instead of requiring the excerpt to be unique. " +
        "Occurrences are found left to right and never overlap, and the success line says how " +
        "many were replaced. It lifts uniqueness, never the requirement to match: an excerpt " +
        "occurring zero times is refused whether or not this is set.",
    },
    JOB_FLAG,
  ],
  examples: [
    {
      command:
        "corpus doc show doc_a1b2c3\n" +
        "corpus doc patch doc_a1b2c3 --from agent --old '30-year fixed at 6.1%.' --new '30-year fixed at 5.8%.'",
      description:
        "The loop: read the document, quote one line of it back exactly, replace it. One request, and the cost is the length of the change rather than the length of the document.",
    },
    {
      command:
        "corpus doc patch doc_a1b2c3 --from agent --old '## Rates\n\n- 30-year: 6.1%' --new '## Rates\n\n- 30-year: 5.8%'",
      description:
        "Multi-line is the normal case, and single quotes span lines in every shell. Quoting the heading above the line that changed is also how an otherwise ambiguous excerpt is made unique.",
    },
    {
      command:
        "corpus doc patch doc_a1b2c3 --from agent --old '\n> Draft: do not circulate.\n' --new ''",
      description:
        "A deletion: quote the text and give an empty replacement. Quoting the newlines around it takes the blank line with it instead of leaving a hole.",
    },
    {
      command:
        "corpus doc patch doc_a1b2c3 --from agent --old 'the Rate Sheet' --new 'the rate sheet' --all",
      description:
        "Every occurrence, when replacing them all is genuinely what you meant. Without --all, an excerpt occurring more than once is refused with the count.",
    },
    {
      command:
        "corpus doc patch doc_a1b2c3 --from agent --stdin <<'CORPUS_EOF'\n" +
        '{"old": "It\'s the lender\'s `rate` figure.\\n", "new": "It is the lender\'s published rate.\\n"}\n' +
        "CORPUS_EOF",
      description:
        "The whole request as JSON on stdin, for text whose quotes and backticks would fight the shell. It carries `all` itself, so it takes no other patch flag.",
    },
    {
      command:
        "corpus doc patch doc_a1b2c3 --from agent --old-file /tmp/old.md --new-file /tmp/new.md",
      description:
        "Two files, read byte for byte: no shell quoting and no JSON escaping anywhere. Each file's trailing newline is part of its text.",
    },
    {
      command: "corpus doc patch doc_a1b2c3 --old 'a line that occurs twice' --new 'x' ; echo $?",
      description:
        "A refused patch: exit **10**, nothing written, and the message names how many times the excerpt matched — 0 means re-read the document, more than one means quote more context or pass --all.",
    },
    {
      command: "corpus doc patch doc_a1b2c3 --from agent --old 'old text' --new 'new text' --json",
      description:
        'One JSON value carrying `doc` (whose `key` is the fresh one), `anchors.remapped`, `anchors.orphaned`, `warnings` and `replaced`. A refusal is `{"error":{…}}` on stderr, with `details.reason` and `details.matches`.',
    },
  ],
  handler: (context) => runDocPatch(context),
};
