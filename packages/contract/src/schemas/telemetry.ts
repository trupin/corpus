import { z } from "zod";
import { DocumentIdSchema } from "./id.js";
import { IsoDateTimeSchema } from "./time.js";
import { openapi } from "./openapi-metadata.js";

/**
 * Cost telemetry (SPEC.md §9.4) — the shapes behind the CLI's per-invocation
 * report and a document's own cost series.
 *
 * §9.4 in one sentence: every `corpus` invocation reports, after its work is
 * done, how many bytes the caller wrote and how many the command printed,
 * attributed to the documents and threads the invocation **named**. The server
 * keeps those measurements as runtime state beside the queue — never a
 * document, never committed — and a document's view draws its own cost over
 * time beside its size.
 *
 * Two properties of that sentence shape everything in this module:
 *
 * - **Bytes on the wire in, tokens on the wire out.** The CLI reports bytes,
 *   because bytes are the thing it can count deterministically and check with
 *   `wc -c`. Tokens are the workspace's *estimate*, derived server-side by
 *   {@link estimateTokens} — one definition, one caller, no second division by
 *   four anywhere (sprint-025 R1).
 * - **The channel is advisory.** A report that fails to arrive costs the
 *   command nothing and is never retried, so nothing in this module may be
 *   load-bearing for any verb's outcome. That is why ingestion answers `204`
 *   with no body, promises no idempotency, and refuses nothing it could
 *   plausibly keep.
 */

/**
 * The workspace's house estimate: **four bytes to a token.**
 *
 * Not a tokenizer and never presented as one. Its whole value is that a person
 * can reproduce a figure the panel shows by hand — `wc -c` on what a command
 * printed, divided by four — which a real tokenizer would take away in exchange
 * for accuracy nothing here needs. §9.4 says the size is "counted
 * deterministically as bytes, shown as the workspace's token estimate", and
 * this is the whole of the second half.
 *
 * It is declared here rather than in the server because three consumers need
 * the same number: the server derives the figures, the UI labels them, and the
 * CLI's help note names the unit. The repository's other copy —
 * `scripts/skill-budget.ts` — is development tooling that no workspace package
 * imports, and it stays where it is.
 */
export const BYTES_PER_TOKEN = 4;

/**
 * `bytes` as the workspace's token estimate — **rounded up** (CONTRACT-097).
 *
 * ## The rounding mode is a decision, and this is it
 *
 * `Math.ceil`, so `estimateTokens(0)` is `0` and every non-empty measurement is
 * at least one token. That single property is the reason:
 *
 * - **A zero means nothing was measured.** The panel must tell "no measurements
 *   yet" from a real reading (§9.4's whole point is looking rather than
 *   feeling), and rounding a three-byte command down to `0` publishes a
 *   measured invocation as free. Rounding down loses every measurement under
 *   two bytes to nearest and under four to floor; rounding up loses none.
 * - **It errs in one stated direction.** An estimate that can read low is worse
 *   than one that can read high by less than a token, because the question the
 *   panel answers — is working with this document getting more expensive? — is
 *   asked by somebody who would rather be warned early.
 * - **It is still reproducible by hand.** `wc -c` divided by four, rounded
 *   **up**, is the rule, and it is stated on the wire as well as here.
 *
 * The repository's existing meaning of the number (`scripts/skill-budget.ts`)
 * is `Math.round`, and it is deliberately not inherited: that budget reports one
 * total over a large file, where no rounding mode can produce a misleading zero.
 *
 * ## Convert at one grain, then sum — never convert twice
 *
 * No rounding is additive: `ceil(1/4) + ceil(1/4)` is `2` while `ceil(2/4)` is
 * `1`. So a response that converted at two grains would publish a breakdown
 * that does not add up to its own total, which is the one arithmetic error a
 * reader is guaranteed to notice. {@link CostBucketSchema} therefore fixes the
 * grain — one conversion per command per direction — and every coarser figure
 * it publishes is a plain sum of those. Apply this function once, at the
 * declared grain, and add whole tokens above it.
 *
 * `bytes` is a non-negative integer byte count, which is what the wire admits
 * ({@link InvocationReportSchema}).
 */
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/**
 * The resolved command path — `thread show`, `search` — as the CLI's own
 * registry spells it.
 *
 * The pattern is the registry's `NAME_PATTERN` (`apps/cli/src/registry/validate.ts`)
 * applied to a topic and its verb: `validateRegistry` refuses any topic or
 * command name that does not match it, so no legal invocation can fail this
 * check. That matters more here than on an ordinary route: a rejected report is
 * silently lost, so a pattern that could refuse a real command would hide
 * measurements rather than surface a bug.
 */
export const COMMAND_PATH_PATTERN = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)?$/;

/** Longest command path the wire admits — far past `topic verb` at CLI name lengths. */
export const COMMAND_PATH_MAX_LENGTH = 64;

/**
 * How many documents and threads one invocation may name.
 *
 * Bounded because ingestion turns each subject into a row, and an unbounded
 * array lets one request write an unbounded ledger. Sixty-four is far past
 * every verb's real reach — the widest surface is a bulk action over a staged
 * selection — and a report past the cap is refused with a `400` and, being
 * advisory, simply lost.
 */
export const MAX_REPORT_SUBJECTS = 64;

/** How many invocations one batched report may carry (see {@link InvocationReportBatchSchema}). */
export const MAX_REPORT_BATCH = 128;

/**
 * One invocation's measurement (SPEC.md §9.4).
 *
 * **Deliberately minimal**: no per-flag detail, no payload echo, no argv. The
 * command path is the finest grain this channel carries, because the question
 * it exists to answer is what a *document* costs, and a flag breakdown would
 * make the ledger a record of what was typed instead.
 */
export const InvocationReportSchema = openapi(
  z.strictObject({
    command: z
      .string()
      .min(1)
      .max(COMMAND_PATH_MAX_LENGTH)
      .regex(COMMAND_PATH_PATTERN)
      .describe(
        "The **resolved command path** — `thread show`, `doc list`, `search` — composed of the " +
          "topic and the verb exactly as `corpus --help` spells them, never the raw argv and " +
          "never a truncated label. It is the key `DocumentCost` groups a bucket's breakdown by, " +
          "so two spellings of one command would show as two lines that each look like the " +
          "whole cost of that verb.",
      ),
    wroteBytes: z
      .number()
      .int()
      .min(0)
      .describe(
        "How many bytes the caller **wrote into** this invocation, counted as UTF-8 bytes — a " +
          "body containing multi-byte characters counts its bytes, never its characters. Zero is " +
          "legal and ordinary: a read verb with a short argv still writes a handful of bytes, " +
          "and a verb invoked with nothing at all writes none.",
      ),
    readBytes: z
      .number()
      .int()
      .min(0)
      .describe(
        "How many bytes this invocation **printed**, counted as UTF-8 bytes, as delivered — so " +
          "`corpus … > out.json && wc -c < out.json` reproduces this number exactly. Bytes a " +
          "closed pipe refused are not delivered and are not counted.",
      ),
    subjects: z
      .array(DocumentIdSchema)
      .max(MAX_REPORT_SUBJECTS)
      .describe(
        "The documents and threads this invocation **named in its own input** — positional or " +
          "flag, never ids read back out of the response. Threads are documents, so a `th_*` id " +
          "belongs here like any other.\n\n" +
          "**An empty array is legal and is the honest answer for a whole class of verbs.** " +
          "`corpus search` and `corpus doc list` name no document: they take a query or filters " +
          "and return ids in their output, and attributing a listing's cost to the documents it " +
          "*returned* would be a different metric from the one §9.4 defines. Such an invocation " +
          "reports zero subjects rather than guessing.\n\n" +
          "Each subject gets the whole invocation's figures, not a share of them: two subjects " +
          "means both documents paid this command, which is what a per-document series is asked " +
          "to show. An id naming no document is kept rather than refused — the invocation " +
          "happened, and a document deleted since is not a reason to lose the measurement.",
      ),
    at: IsoDateTimeSchema.describe(
      "When the invocation finished. Carried by the report rather than stamped on arrival, " +
        "because a batched report may be sent later than the invocations in it happened — that " +
        "is the whole reason the batch form exists.",
    ),
  }),
  "InvocationReport",
);

/**
 * The batch form — **for a future buffering CLI, not for today's.**
 *
 * Today's CLI sends one report per invocation, awaited under a hard cap and
 * never retried (sprint-025 R4). This shape exists so that a CLI which later
 * buffers reports across invocations needs no second route and no contract
 * release: the ingestion route accepts either form from the day it lands. A
 * client should not batch merely because it can — one report per invocation is
 * what the current CLI does, and it keeps `at` honest without effort.
 */
export const InvocationReportBatchSchema = openapi(
  z.strictObject({
    invocations: z
      .array(InvocationReportSchema)
      .max(MAX_REPORT_BATCH)
      .describe(
        "Several invocations in one request, each carrying its own `at`. An empty array is legal " +
          "and records nothing. Order does not matter: the ledger is append-only and buckets are " +
          "derived from `at`.",
      ),
  }),
  "InvocationReportBatch",
);

/**
 * Which form was sent, said in one sentence, because Zod reports a failed union
 * as a single top-level issue and "Invalid input" would tell a caller nothing.
 * The same arrangement `POST /api/check` uses for its XOR, for the same reason.
 */
export const INVOCATION_REPORT_FORM_MESSAGE =
  "Send either one invocation — `{command, wroteBytes, readBytes, subjects, at}` — or a batch " +
  "of them under `invocations`. No other key, and never both forms in one body.";

/**
 * One invocation **or** a batch of them.
 *
 * Both branches are closed objects, so `invocations` beside the single form's
 * keys matches neither branch and the refusal names the offending key itself.
 * The union is declared inline rather than registered as a component: an
 * `anyOf` has no `type: "object"`, and a registered name would propagate onto
 * anything derived from it (CONTRACT-037).
 */
export const InvocationReportRequestSchema = z.union(
  [InvocationReportSchema, InvocationReportBatchSchema],
  { error: INVOCATION_REPORT_FORM_MESSAGE },
);

/**
 * The spans a cost bucket may cover. **The server picks one and the response
 * says which** — a caller must never infer a granularity from two boundaries,
 * because a bucket that happens to hold nothing is indistinguishable from a
 * gap in the series.
 *
 * A closed vocabulary rather than an open string, because the panel *labels*
 * it: a granularity the UI has never heard of renders as a raw word beside an
 * axis. Adding a fourth is therefore a contract change on purpose — it is a
 * change the UI must follow.
 */
export const COST_BUCKET_GRANULARITIES = ["hour", "day", "week"] as const;

export const CostGranularitySchema = openapi(z.enum(COST_BUCKET_GRANULARITIES), {
  description:
    "The span each bucket in this response covers, chosen by the server and stated rather than " +
    "left to be inferred from `from` and `to` — a bucket may legitimately hold nothing, and an " +
    "empty bucket read as a gap turns a quiet week into a hole in the chart.",
  example: "day",
});

/** Buckets returned when the caller names no `limit`. Six months of daily buckets. */
export const DEFAULT_COST_BUCKETS = 180;

/** The most buckets one response may carry, whatever `limit` asks for. */
export const MAX_COST_BUCKETS = 500;

export const CostQuerySchema = z.object({
  limit: openapi(
    z.coerce.number().int().min(1).max(MAX_COST_BUCKETS).default(DEFAULT_COST_BUCKETS),
    {
      param: { name: "limit", in: "query", required: false },
      description:
        `How many buckets to return (1–${String(MAX_COST_BUCKETS)}, default ` +
        `${String(DEFAULT_COST_BUCKETS)}). The **newest** buckets are the ones kept, and ` +
        "`truncated` says whether anything older was cut.",
    },
  ),
});

/**
 * One span of a document's cost (SPEC.md §9.4).
 *
 * ## Where the rounding happens, once
 *
 * `estimateTokens` rounds, and rounding is not additive, so a response that
 * converted bytes to tokens at two different grains would publish a breakdown
 * that does not sum to its own total. This schema fixes the grain instead:
 *
 * > The estimate is taken **once per command per direction** inside a bucket.
 * > `byCommand` is the sum of a command's two directions; `wroteTokens` and
 * > `readTokens` are the sums of one direction over the commands. Both
 * > decompositions are therefore sums of the same whole tokens, and
 * > `byCommand` adds up to `wroteTokens + readTokens` exactly.
 *
 * Neither figure is `estimateTokens` of the bucket's own summed bytes, and the
 * difference is at most one token per command per direction. The exact
 * arithmetic is worth that: a panel whose parts do not add up is read as broken,
 * and nobody can check a bucket's byte total by hand anyway. One invocation's
 * `readBytes` against `wc -c` is the hand check this estimate exists to
 * survive, and it is unaffected.
 */
export const CostBucketSchema = openapi(
  z.object({
    from: IsoDateTimeSchema.describe(
      "Start of the span, inclusive. Buckets are contiguous and aligned to `granularity`, so " +
        "each bucket's `from` is the previous one's `to`.",
    ),
    to: IsoDateTimeSchema.describe(
      "End of the span, **exclusive** — an invocation stamped exactly here belongs to the next " +
        "bucket. The last bucket may still be filling.",
    ),
    wroteTokens: z
      .number()
      .int()
      .min(0)
      .describe(
        "The token estimate of what callers wrote into this bucket's invocations — argv and " +
          "piped bodies. Summed from the per-command estimates rather than converted from the " +
          "bucket's total bytes, so it agrees with `byCommand` exactly (see the component's own " +
          "note on where the rounding happens).",
      ),
    readTokens: z
      .number()
      .int()
      .min(0)
      .describe(
        "The token estimate of what this bucket's invocations printed. Usually the larger half, " +
          "and the one that answers §9.4's question: reads growing while the document grows is " +
          "what an unbounded read looks like on a chart.",
      ),
    invocations: z
      .number()
      .int()
      .min(0)
      .describe(
        "How many invocations named this document in this span. **Invocations, not ledger rows**: " +
          "one invocation naming two documents counts once here and once in the other document's " +
          "series, because each of them paid the whole command.",
      ),
    byCommand: z
      .record(z.string().regex(COMMAND_PATH_PATTERN), z.number().int().min(0))
      .describe(
        'Tokens per resolved command path in this span — `{"thread show": 412}` — which is the ' +
          "finest grain this channel carries (there is no per-flag or per-payload detail, by " +
          "design). Each value is that command's written **and** printed tokens together, so the " +
          "values sum to `wroteTokens + readTokens` exactly. A command that spent nothing in this " +
          "bucket has no key rather than a zero.",
      ),
  }),
  "CostBucket",
);

/**
 * A document's own cost over time (SPEC.md §9.4, §10's panel).
 *
 * **A series plus one present-tense number.** `buckets` is a history;
 * `sizeBytes` is what the document weighs right now, and there is deliberately
 * no history of it — the projection keeps one size per file, so the reference
 * line a panel draws against the series is a horizontal line at today's size
 * and must be labelled as one. A second series here would be a claim the
 * workspace cannot support.
 */
export const DocumentCostSchema = openapi(
  z.object({
    granularity: CostGranularitySchema,
    buckets: z
      .array(CostBucketSchema)
      .describe(
        "The series, **oldest first**, so it reads left to right the way it is drawn. " +
          "An empty array means nothing has been measured for this document — never that it " +
          "cost nothing, and never a series of zeros to plot.",
      ),
    total: z
      .number()
      .int()
      .min(0)
      .describe(
        "**How many buckets this document's series holds in total**, before `limit` bounded the " +
          "response — equal to `buckets.length` whenever `truncated` is false. It is the " +
          "`showing N of M` a windowed list owes its reader, spelled as `JobList.total` spells it.",
      ),
    truncated: z
      .boolean()
      .describe(
        "True when `limit` cut the series — `total` is then greater than `buckets.length`, and " +
          "the buckets that were cut are the **oldest** ones. Stated rather than left to be " +
          "derived, the rule `JobList.truncated` sets: a window reads exactly like a whole " +
          "history, and a panel that presents one as the other says the document has been cheap " +
          "since a date it invented.",
      ),
    sizeBytes: z
      .number()
      .int()
      .min(0)
      .describe(
        "The document's **current** byte length on disk, frontmatter included — one present-tense " +
          "number, not a history, and not a second series. It is the reference line §9.4 asks the " +
          "panel to draw the cost against, so that flat cost against a growing document is " +
          "visible at a glance. Read from the projection's per-file size, so this response " +
          "performs no filesystem read.",
      ),
    measuringSince: IsoDateTimeSchema.nullable().describe(
      "When this workspace's ledger started collecting, or `null` when it holds nothing at all. " +
        "Telemetry is runtime state beside the queue (§9.4): it is absent after a rebuild and " +
        "after a projection schema change, and none the worse for it — but a panel that cannot " +
        "tell *never measured* from *measured since Tuesday* would present a short history as a " +
        "whole one. It is the honest caption for an otherwise flattering chart, and it is a " +
        "property of the workspace rather than of this document.",
    ),
  }),
  "DocumentCost",
);

export type InvocationReport = z.infer<typeof InvocationReportSchema>;
export type InvocationReportBatch = z.infer<typeof InvocationReportBatchSchema>;
export type InvocationReportRequest = z.infer<typeof InvocationReportRequestSchema>;
export type CostGranularity = (typeof COST_BUCKET_GRANULARITIES)[number];
export type CostQuery = z.infer<typeof CostQuerySchema>;
export type CostBucket = z.infer<typeof CostBucketSchema>;
export type DocumentCost = z.infer<typeof DocumentCostSchema>;
