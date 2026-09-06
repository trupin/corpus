import { z } from "zod";
import { ThreadIdSchema } from "./id.js";
import { IsoDateTimeSchema } from "./time.js";
import { warningsField } from "./warning.js";
import { openapi } from "./openapi-metadata.js";

/**
 * A thread's **digest** — SPEC.md §6's rider signed 2026-09-05: *"A thread may
 * carry a digest — one, written by its resident, never by the server."*
 *
 * ## What the wire shape has to make impossible
 *
 * The rider is short and every sentence of it is a constraint on this file, so
 * the mapping is written out rather than left to be re-derived:
 *
 * | Rider sentence | What carries it here |
 * | --- | --- |
 * | *"one, written by its resident"* | one field on the thread, never an array, and a write is refused on a thread with no resident (`422`) |
 * | *"never by the server"* | `body` reaches the wire only through `PUT /api/threads/{id}/digest`, and the server neither composes nor repairs it |
 * | *"records the timestamp of the newest turn it covers"* | {@link ThreadDigestSchema}'s `watermark`, stamped server-side because only the server knows what the newest turn is at the instant of the write |
 * | *"marks the digest stale ... and changes nothing else"* | `stale`, a flag beside the body rather than a rewrite of it |
 * | *"shown as stale wherever it is shown"* | `stale` is part of the digest object, so no surface can carry the body without it |
 * | *"a thread with no digest is the ordinary state, not a fault"* | `null`, required and never an absent key |
 *
 * ## Stale is not "uncovered"
 *
 * Two different facts, and collapsing them would make the flag useless. Turns
 * **after** the watermark are simply not yet covered — the ordinary state
 * between a message landing and the resident's next reply — and the digest is
 * not stale for having them. Staleness is the narrower fact the rider names: a
 * turn **at or before** the watermark was deleted or revised, so the account
 * covers text that is no longer there. A client reads coverage from
 * `watermark` against the thread's turns, and trust from `stale`.
 *
 * ## Why the write route has no `watermark` field
 *
 * The writer cannot state one honestly. Between reading the thread and sending
 * the digest, a turn may land — so a watermark chosen by the writer is a claim
 * about a moment that has already passed, and it would silently over-claim
 * coverage of a turn the digest never saw. The server is the only party that
 * knows what the newest turn is at the instant of the write, so it stamps it.
 * That is the one thing the server contributes to a digest, and it is a
 * timestamp rather than prose.
 */

/**
 * How long a digest's prose may be, in characters.
 *
 * The rider says *"a short prose account"*, and this is the number that says
 * what short means. Two thousand characters is a few paragraphs — enough to
 * account for a long conversation, never enough to become a substitute for
 * reading it, which is the distinction the rider's *"digests orient"* sentence
 * draws.
 *
 * **Enforced on the write and stated on the read** (CONTRACT-096). The bound is
 * a `.max()` on {@link WriteDigestRequestSchema} — a `400` naming the field —
 * and deliberately **not** a `.max()` on {@link ThreadDigestSchema}. A
 * response-side ceiling is only honest if something can bring an over-long value
 * back inside it, and here nothing may: the one repair available is truncation,
 * and the rider forbids the server to edit a digest at all. A digest hand-written
 * into a thread's frontmatter past this bound therefore travels whole and reads
 * as what it is, rather than being silently cut or refused on the way out. That
 * is this package's standing posture — strict bodies, tolerant reads
 * (CONTRACT-017) — reaching a case where the alternative would break a signed
 * sentence.
 *
 * It is also the bound the context pack relies on, which is why one number
 * serves both: the pack carries this component whole, so a digest that fits here
 * fits there, and the pack never needs a truncation flag for it.
 */
export const DIGEST_MAX_CHARS = 2000;

/**
 * The digest as it is read — the prose, what it covers, and whether it can still
 * be trusted to cover it.
 *
 * Three fields and no author: a digest's author is the thread's resident by
 * construction (the write is refused on a thread with no resident), so a field
 * naming one would be a second, staler answer to a question `Thread.resident`
 * already answers. There is no `updated` either — `watermark` is the timestamp
 * that matters, and a write time would only invite a client to compare the wrong
 * two instants.
 */
export const ThreadDigestSchema = openapi(
  z.object({
    body: z
      .string()
      .describe(
        "**The digest's prose, exactly as its author wrote it** (SPEC.md §6, rider signed " +
          "2026-09-05). Markdown, a short account of the conversation so far. Written by the " +
          "thread's resident through `PUT /api/threads/{id}/digest` and **by nothing else**: the " +
          "server never generates it, never edits it and never repairs it, because a summary " +
          `nobody wrote is worse than none. Writes are bounded at ${DIGEST_MAX_CHARS} ` +
          "characters (`DIGEST_MAX_CHARS`); this field publishes no ceiling of its own, since " +
          "the only way to bring an over-long value inside one would be to cut it, and cutting " +
          "it is editing it. **It orients, and it is not a source**: an agent quotes and edits " +
          "from turns it has read verbatim, never from this.",
      ),
    watermark: IsoDateTimeSchema.describe(
      "**The timestamp of the newest turn this digest covers** (SPEC.md §6). A turn's `ts` — the " +
        "turn's identity within the thread — and always one that existed when the digest was " +
        "written. **Stamped by the server**, never by the writer: only the server knows what the " +
        "newest turn is at the instant of the write, so the write request carries no watermark " +
        "field at all. Turns newer than this are **not yet covered**, which is the ordinary state " +
        "between a message landing and the resident's next reply — it is not staleness, and it " +
        "does not make the digest wrong about what it does cover.",
    ),
    stale: z
      .boolean()
      .describe(
        "**Whether a turn at or before `watermark` was deleted or revised since** (SPEC.md §6), " +
          "so this account covers text that is no longer there. `true` is the server *recording* " +
          "that, and it changes nothing else: the body is left exactly as written, because " +
          "repairing it is the resident's act and never the server's. A stale digest **is shown " +
          "as stale wherever it is shown**, which is why the flag rides inside the digest object " +
          "rather than beside it — a surface cannot carry the prose without carrying this. It " +
          "clears only when a resident writes the digest again. **Not the same as uncovered**: " +
          "turns *after* the watermark leave this `false`, and are read from `watermark` instead.",
      ),
  }),
  "ThreadDigest",
);

/**
 * The digest as a field of something else — the thread, and the thread's context
 * pack.
 *
 * `z.union([ThreadDigestSchema, z.null()])` and never `ThreadDigestSchema
 * .nullable()`: `zod-to-openapi` propagates a registered component name onto a
 * schema derived from it, so the second spelling would rewrite the shared
 * `ThreadDigest` component to `type: ["object", "null"]` for every route that
 * references it (CONTRACT-037).
 *
 * Required and null, never absent. *"A thread with no digest is the ordinary
 * state, not a fault"* — so the ordinary state is a value a client reads, not a
 * key it probes for.
 */
export const digestField = z
  .union([ThreadDigestSchema, z.null()])
  .describe(
    "The thread's digest — a short prose account of the conversation so far, written by the " +
      "thread's **resident** and never by the server (SPEC.md §6, rider signed 2026-09-05) — or " +
      "**null**, which is the ordinary state and not a fault. One per thread: a second write " +
      "replaces the first, and there is no history of them here. A thread with no resident never " +
      "has one, because writing it is refused on such a thread. Read `stale` before quoting " +
      "anything from it, and read the conversation itself before quoting anything at all: a " +
      "digest orients, and an agent quotes and edits from turns it has read verbatim.",
  );

/**
 * The write (`PUT /api/threads/{id}/digest`).
 *
 * Strict, like every request body (CONTRACT-017), and **one field**: everything
 * else about a digest is the server's to record. A `watermark` key would be
 * refused by name, which is the outcome worth having — a writer that thought it
 * could state its own coverage finds out at the boundary rather than by watching
 * a value it sent get ignored.
 */
export const WriteDigestRequestSchema = openapi(
  z.strictObject({
    // Deliberately **no** `.min(1)`. An empty body is refused with `422`, not
    // with the `400` a parse failure produces, because the refusal is about the
    // act and not the shape: an empty PUT is not a clear, and clearing has its
    // own verb. Adding a minimum here would quietly move that refusal to a
    // status that tells the caller to fix its body and retry — which, for a
    // caller that meant to clear, is a loop.
    body: z
      .string()
      .max(DIGEST_MAX_CHARS)
      .describe(
        "The digest's prose — markdown, a short account of the conversation so far. At most " +
          `${DIGEST_MAX_CHARS} characters (\`DIGEST_MAX_CHARS\`); longer is a \`400\` naming ` +
          "this field. **Blank is refused, not honoured**: an empty or whitespace-only body is a " +
          "`422`, because clearing a digest is `DELETE /api/threads/{id}/digest` and an empty " +
          "write is not a clear. **There is no `watermark` field on purpose** — the server stamps " +
          "the newest turn's timestamp at the instant of the write, which is the only moment at " +
          "which it can be stated truthfully. A write replaces whatever digest the thread had and " +
          "clears its `stale` flag.",
      ),
  }),
  "WriteDigestRequest",
);

/**
 * What both digest routes answer with.
 *
 * **Not `ThreadMutationResponse`.** That envelope carries a `ThreadSummary`,
 * which does not carry a digest and must not start to: a summary is every row of
 * `GET /api/docs?type=thread`, and putting a digest body on every row would cost
 * a listing exactly what the digest's own bound exists to prevent. So the write
 * answers with the digest itself — which it must, since the writer cannot know
 * the watermark the server stamped and would otherwise have to re-read the
 * thread to learn what it just wrote.
 *
 * **One shape for both verbs**, the way `ThreadMutationResponse` serves
 * `resolve` and `reopen`: `digest` is the digest after the call, so it is
 * non-null after a write and null after a clear, and a client that renders a
 * digest renders this field whichever verb produced it.
 *
 * **It carries §11's warnings** for the reason every thread mutation does:
 * writing a digest rewrites the thread file's frontmatter and auto-commits it,
 * so a workspace git hook that rejects the commit leaves the change on disk and
 * uncommitted — and §11 requires that to surface on the response rather than in
 * a log.
 */
export const ThreadDigestResponseSchema = openapi(
  z.object({
    threadId: ThreadIdSchema.describe("The thread whose digest this is."),
    digest: digestField.describe(
      "The thread's digest **after this call**: the stored digest — its `watermark` stamped by " +
        "the server and its `stale` cleared — after a write, and **null** after a clear, " +
        "including a clear that had nothing to clear. Read the watermark from here rather than " +
        "guessing it: the writer never states one.",
    ),
    warnings: warningsField,
  }),
  "ThreadDigestResponse",
);

export type ThreadDigest = z.infer<typeof ThreadDigestSchema>;
export type WriteDigestRequest = z.infer<typeof WriteDigestRequestSchema>;
export type ThreadDigestResponse = z.infer<typeof ThreadDigestResponseSchema>;
