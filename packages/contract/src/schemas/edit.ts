import { z } from "zod";
import { DocumentIdSchema } from "./id.js";
import { openapi } from "./openapi-metadata.js";

/**
 * **Edit acknowledgment** (SPEC.md §4, rider signed 2026-08-02) — the wire half
 * of the loop that lets the agent notice what the *user* wrote.
 *
 * Two shapes live here, and they are one feature rather than two:
 *
 * 1. The `doc.edited` queue event's payload — what the server announces when a
 *    user edit session ends. It carries the document id and the session's commit
 *    range with change stats, and **never the diff body**.
 * 2. `GET /api/docs/{id}/diff`'s query and response — the bounded read behind
 *    `corpus doc diff <id>` (CLI-026), which is how an agent that decides the
 *    change matters gets the actual text.
 *
 * **Why the event carries no diff.** §2.2's rule is that the SSE stream and the
 * queue announce *that* something changed and never *what* — document content is
 * fetched over HTTP, deliberately, so that a notification's cost does not scale
 * with the size of the thing it notifies about. A `doc.edited` carrying a diff
 * body would put a whole rewritten document into a queue file, into the console's
 * job row, and into the agent's context before the agent has decided the change
 * is worth reading. The stats below are the triage budget; the diff route is the
 * escalation, and it is one deliberate call away.
 *
 * **Why the range is usable verbatim.** The event's `from`/`to` are exactly what
 * the diff route's `from`/`to` accept, in the same spelling, so the agent's whole
 * fetch is "pass back what I was handed". Nothing in the loop has to parse,
 * resolve or reconstruct a revision — which is also why both sides are commit
 * shas rather than the wider git revision DSL (see {@link CommitShaSchema}).
 */

/**
 * Git's empty tree object — the hash of a tree with nothing in it, identical in
 * every repository ever created, and a revision every git range operation
 * accepts.
 *
 * It is the value both the event and the diff route report as `from` when
 * **nothing before the range's head ever touched this document** — that is, when
 * the head is the document's first commit, whether or not it is also the
 * repository's root. Diffing against it yields the file as wholly added, which is
 * the truth about a document with no earlier revision. The alternative — a
 * nullable `from` meaning "no base" — would make every consumer of every range
 * handle a second null case, and would make a range no longer passable straight
 * back to the diff route. One well-known constant costs nothing and keeps both
 * properties.
 *
 * **It is not the exotic case it once was.** Both bases are resolved by walking
 * *this document's* history rather than the branch's (SERVER-097, SERVER-113),
 * because §4's commit windows are party-scoped and the commit sitting immediately
 * before a document's first one is routinely another party's save to a different
 * file — a commit at which this document did not exist. So every document's first
 * change diffs against the empty tree, not only one created by the repository's
 * root commit.
 *
 * Published here so the server, the CLI and any consumer that wants to *say*
 * "this document is new" spell it identically instead of each hard-coding forty
 * hex characters.
 */
export const EMPTY_TREE_OBJECT_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * A git commit sha: 7–64 lowercase hex characters, abbreviated or full.
 *
 * **Deliberately not the wider revision DSL**, and this is a security boundary
 * rather than a convenience. Every range a caller has comes from `doc.edited`
 * events, which carry shas, so accepting `HEAD~1` or a tag would buy nothing and
 * cost the server a git argv built from an arbitrary caller-supplied token.
 * `HEAD~1`, `--output=/tmp/x`, `-C/etc` and every other leading-dash or DSL
 * string is a `400` naming the parameter, before a handler — and therefore
 * before a `git` process — exists.
 *
 * The same pattern is spelled inline in `DoctorWarning.commit` and is
 * left there: that one is a *nullable* response field, and a registered or
 * shared schema used through `.nullable()` is exactly the derivation that
 * rewrites a component under its own name (see the note atop `./id.ts`). Two
 * inline primitives with one documented shape, rather than one shared component
 * with a hazard.
 */
export const CommitShaSchema = openapi(z.string().regex(/^[0-9a-f]{7,64}$/), {
  description:
    "A git commit sha — 7–64 lowercase hex characters, abbreviated or full. Only a sha: named " +
    "revisions (`HEAD~1`, tags, branch names) are rejected with a `400`, because every range a " +
    "caller holds comes from a `doc.edited` event and every one of those is a sha.",
  example: "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456",
});

/**
 * What changed in a document across a commit range, in the three numbers git
 * furnishes without reading the diff (`git diff --shortstat`, path-scoped).
 *
 * **What is deliberately absent: a file count.** `git diff --shortstat` leads
 * with "N files changed", and N is always 1 here — both surfaces that carry these
 * stats are scoped to a single document's file — so publishing it would publish a
 * constant. A constant is not a statistic.
 *
 * **Why these three are enough to triage on.** The agent's question on waking to
 * a `doc.edited` is not "what did the user write" but "is this worth reading, and
 * could it ripple". `insertions`/`deletions` answer the first at a glance — a
 * one-line typo fix and a two-hundred-line rewrite are different jobs, and the
 * agent can acknowledge the former without spending a fetch. `commits` says
 * whether the session was the single squashed commit §4's autosave normally
 * produces or something less tidy. What they cannot answer is *what* changed, and
 * that is the point: the diff route answers that, once, on purpose.
 *
 * Both counts are for the **whole range**, never for a truncated diff body: a
 * `DocDiff` that reports `truncated: true` still reports the real size of the
 * change, which is how a caller knows how much it is not looking at.
 */
export const DocChangeStatsSchema = openapi(
  z.object({
    commits: z
      .number()
      .int()
      .min(0)
      .describe(
        "Commits in the range that touched this document. Normally **1**: §4 folds an editing " +
          "session's repeated autosaves into a single auto-commit, so a session is usually one " +
          "commit and its range is a range of one. More than one means the squash did not fold " +
          "them — saves either side of the squash idle window, or a save that started a fresh " +
          "commit for another of §4's reasons. `0` is reachable only on `GET /api/docs/{id}/diff` " +
          "for a document with no committed history; a `doc.edited` event never carries it, " +
          "because a session that produced no commit produces no event.",
      ),
    insertions: z
      .number()
      .int()
      .min(0)
      .describe("Lines added across the range, path-scoped to this document's file."),
    deletions: z
      .number()
      .int()
      .min(0)
      .describe("Lines removed across the range, path-scoped to this document's file."),
  }),
  "DocChangeStats",
);

/**
 * The two ways a user edit session ends (SPEC.md §4). Closed: the server has
 * exactly these two triggers, and a consumer that wants to distinguish "the user
 * put the document down" from "the user walked away from it" reads this rather
 * than guessing from timing.
 *
 * - `close` — **the reader closed and the UI flushed the session**, by calling
 *   `POST /api/docs/{id}/edit-session/flush` (CONTRACT-031). A signal of its
 *   own, and it has to be: CONTRACT-028 originally read §4's flush as the
 *   release of the user's then-current edit lock ("released on blur, idle, or
 *   close"), which the server already received, and SERVER-052 measured that
 *   against the shipped editor — which dropped the lease on blur and after ten
 *   seconds of not typing, against this session's three minutes. Binding the
 *   close path to it would have ended a session inside every pause, making the
 *   `idle` window below unreachable in every session and fragmenting one sitting
 *   at a document into an event per typing burst. The two signals answered
 *   different questions ("may somebody else write here" and "has the person put
 *   this document down"), so they are two calls. The lock is gone since
 *   SHARED-041 and this session outlived it — it is now also what
 *   `Doc.userEditing` reports (SPEC.md §7).
 * - `idle` — the acknowledgment window elapsed with the document open and no user
 *   write (default 3 minutes, and §4 is explicit that this is "a distinct and
 *   longer window than the commit-squash idle").
 *
 * **The first trigger to fire wins.** Both paths can be true of one session — the
 * window elapses and the user then closes the reader — and the session emits one
 * event regardless (see {@link DocEditedPayloadSchema}'s `sessionId`). This field
 * therefore names the trigger that *ended* the session, never the last thing that
 * happened to it.
 */
export const EDIT_SESSION_END_REASONS = ["close", "idle"] as const;

export const EditSessionEndReasonSchema = z.enum(EDIT_SESSION_END_REASONS);

/**
 * The payload of a `doc.edited` queue event (SPEC.md §4's edit-acknowledgment
 * rider, signed 2026-08-02).
 *
 * Declared beside its feature and **not** as a member of a discriminated union on
 * `QueueEventSchema`, for the reason `FormRespondPayloadSchema` (`./form.ts`)
 * spells out: §7 keeps the event `type` an open string because the set on the
 * wire is not the set any one build knows, so closing the envelope on the core
 * set would make every other event unrepresentable. A consumer that handles `doc.edited`
 * narrows with {@link parseDocEditedPayload}; one that does not is unaffected.
 *
 * **Actor scoping is in the schema, not in the server's memory.** §4: "Agent-
 * authored edits never emit the event (actor-scoped), so the loop cannot feed
 * itself." That guarantee is load-bearing — an agent that woke on its own edits
 * would edit, wake, edit again — so it is expressed as a `z.literal("user")`
 * rather than left to the emitter. The consequence is the useful one: a
 * `doc.edited` whose actor is anything else fails to parse, so a consumer
 * narrowing through {@link parseDocEditedPayload} drops it. The loop still cannot
 * feed itself even if a future server regresses on the emit side.
 *
 * **Idempotence is expressed as an identity, not as a promise.** The two end
 * paths in {@link EditSessionEndReasonSchema} can both fire for one session, and
 * §4 says the server emits **one** event. `sessionId` is what makes "the same
 * session" a fact on the wire: at most one `doc.edited` may ever be enqueued per
 * `sessionId`, and a consumer that sees a repeat — a server bug, a queue file
 * restored from a backup, a replayed batch — may drop it on that basis alone,
 * without diffing payloads or reasoning about timestamps.
 *
 * **The range is the session's, and nothing else's.** `from..to` is a contiguous
 * git range, exclusive of `from` and inclusive of `to`, exactly as `git diff
 * from..to` reads it. The server ends a user session before any other author's
 * commit to the same document could enter that range, so a range never spans an
 * agent commit on this document: a session interrupted by an agent edit becomes
 * two events with two ranges rather than one range crediting the user with the
 * agent's work (SERVER-052 owns the mechanism; this is the property it must
 * preserve). Stats are path-scoped to the document's file, so an interleaved
 * commit touching *other* documents cannot inflate them either.
 *
 * **A session with no commit emits nothing.** §11 lets an auto-commit be rejected
 * by a workspace hook or skipped in a workspace with no git — the write stands and
 * the failure surfaces as a warning on the write itself. Such a session has no
 * range to report, so it produces no event: there is no null-range `doc.edited`,
 * and a consumer never has to handle one.
 */
export const DocEditedPayloadSchema = z.object({
  docId: DocumentIdSchema.describe(
    "The document the user edited. Threads are documents, so a thread id is legal here in " +
      "principle; §4's edit sessions are the reader's editor, which edits documents.",
  ),
  sessionId: z
    .string()
    .min(1)
    .describe(
      "**Opaque identity of the edit session — the dedupe key.** Compare it for equality; never " +
        "parse it. Both of §4's end paths can fire for one session, and exactly one event may " +
        "exist per value: a consumer that has already handled this `sessionId` may drop a second " +
        "event carrying it without inspecting anything else. Distinct sessions on the same " +
        "document always differ.",
    ),
  actor: z
    .literal("user")
    .describe(
      "Always `user`. A literal rather than the `Actor` enum, deliberately: §4 scopes the event to " +
        "user edits so the agent's loop cannot feed itself, which makes an agent-authored value a " +
        "contract violation rather than a variant of this payload. `parseDocEditedPayload` " +
        "therefore rejects it, and the guarantee holds at the consumer as well as at the emitter.",
    ),
  endedBy: EditSessionEndReasonSchema.describe(
    "Which of §4's two triggers ended the session: `close` (the reader closed and the UI flushed " +
      "the session) or `idle` (the acknowledgment window elapsed with the document open, default " +
      "3 minutes). The trigger that *ended* it — the first to fire — never the last thing that " +
      "happened to it.",
  ),
  from: CommitShaSchema.describe(
    "The state this document was in before the session, **exclusive**: the newest commit before " +
      "the session's first one that touched **this document**. Deliberately *not* that commit's " +
      "parent — §4's commit window belongs to a party rather than to a document and gathers a " +
      "party's saves across documents, so the commit immediately preceding a session is routinely " +
      "the other party's save to a different file, and naming it here would be a false claim about " +
      "this document's history. `EMPTY_TREE_OBJECT_ID` when nothing before the session ever " +
      "touched this document, so the range is always well-formed and always passable straight back " +
      "to `GET /api/docs/{id}/diff`, whose default base is resolved the same way.",
  ),
  to: CommitShaSchema.describe(
    "The session's last commit, **inclusive** — usually its only one, since §4 folds an editing " +
      "session into a single auto-commit.",
  ),
  stats: DocChangeStatsSchema.describe(
    "How much changed across the range. The triage budget: enough to decide whether the change is " +
      "worth reading, never enough to say what it was. `corpus doc diff` is the escalation.",
  ),
});

/**
 * The event type {@link DocEditedPayloadSchema} describes. A member of
 * `CORE_QUEUE_EVENT_TYPES`, spelled here so this module does not depend on the
 * queue module it is documented beside — the same arrangement `form.respond`
 * uses.
 */
export const DOC_EDITED_EVENT_TYPE = "doc.edited";

/**
 * Narrows a queue event to a user edit acknowledgment, or returns `undefined`
 * when it is neither — a different type, a payload that does not match, or a
 * payload claiming an actor other than `user`.
 *
 * A malformed payload is not an exception here, for the reason
 * `parseFormRespondPayload` gives: events come off disk, and a consumer that has
 * to survive one written by an older server should skip it rather than crash.
 * The actor check rides the same path deliberately — dropping an agent-authored
 * event is the *correct* handling of it, not an error to report.
 */
export function parseDocEditedPayload(event: {
  readonly type: string;
  readonly payload: unknown;
}): DocEditedPayload | undefined {
  if (event.type !== DOC_EDITED_EVENT_TYPE) return undefined;
  const parsed = DocEditedPayloadSchema.safeParse(event.payload);
  return parsed.success ? parsed.data : undefined;
}

/**
 * How much unified diff `GET /api/docs/{id}/diff` may return, in characters.
 *
 * **The same discipline as the context pack** (`./context.ts`, §7's "the pack is
 * bounded: reading it costs roughly the same however large the corpus grows"),
 * one resource over: reading a document's diff must cost roughly the same however
 * large the document or the change. Without a bound, `corpus doc diff` on a
 * rewritten document is an unbounded paste into the agent's context, and the
 * frugal event above would have bought nothing — the expensive read would simply
 * have moved one call downstream.
 *
 * **The number is chosen, not inherited.** Four times `CONTEXT_MAX_SECTION_CHARS`
 * (4000), because a diff legitimately carries both sides of every changed hunk
 * plus its context lines, where a pack carries one section once — and under a
 * quarter of `EXTRA_MAX_BYTES` (65536), so the largest answer this route can give
 * still sits well inside a subagent's budget rather than crowding out the work it
 * was woken for. In practice it is far above a real editing session: §4's sessions are a
 * person typing, and the stats on the event let a caller see before it fetches
 * when a change is the rare one that will not fit.
 *
 * A **character** cap rather than a byte cap because the value on the wire is a
 * JSON string, and characters are what a client can check against `diff.length`
 * without re-encoding.
 */
export const DOC_DIFF_MAX_CHARS = 16000;

/**
 * The revision range of `GET /api/docs/{id}/diff`, both halves optional.
 *
 * **Optional-in, server-defaulted-out** (`./index.ts`): neither carries a Zod
 * `.default()`, because there is no literal to default to — the resolved values
 * are computed from the document's own history and reported back in the response.
 * The two rules are independent and compose, which is what makes `corpus doc diff
 * <id>` with no flags — the spelling SPEC.md §4 itself uses — mean something
 * useful rather than being an error:
 *
 * - `to` omitted → the newest commit that touched this document.
 * - `from` omitted → the newest commit **before `to` that touched this document**
 *   (or `EMPTY_TREE_OBJECT_ID` when nothing before it did), i.e. that one
 *   commit's own change to this document.
 *
 * **Both defaults walk this document's history, never the branch's**, and that is
 * the whole of why `from` is not simply `to`'s parent (SERVER-113): §4's commit
 * windows are party-scoped and gather a party's saves across documents, so the
 * parent of a window commit is not this document's previous state — it is
 * whichever *other* document the other party happened to save in the same window.
 * Both bases would produce the same numbers and the same bytes, since every read
 * here is path-scoped; only one of them is a true statement about where this
 * document came from, and `from` is published in the response as a fact.
 *
 * So no arguments reads "what changed in this document's last commit", and the
 * pair handed over by a `doc.edited` event reads "what changed in that session".
 * Defaulting to the range of the most recent `doc.edited` event is deliberately
 * **not** what happens: the verb stays stateless and the skill passes the range it
 * was given (CLI-026).
 */
export const DocDiffQuerySchema = z.object({
  from: openapi(CommitShaSchema.optional(), {
    param: { name: "from", in: "query", required: false },
    description:
      "Base of the range, **exclusive** — `git diff from..to`. Omit it to use the newest commit " +
      "**before `to` that touched this document**, which reads as that one commit's own change to " +
      "it; when nothing before `to` ever touched this document the base is git's empty tree, so a " +
      "document's first change diffs as wholly added. Deliberately **not `to`'s parent**: §4's " +
      "commit windows are party-scoped and gather a party's saves across documents, so the parent " +
      "of a window commit is routinely another party's save to a different file rather than this " +
      "document's previous state. Must be a commit sha: a named revision is a `400` naming this " +
      "parameter.",
  }),
  to: openapi(CommitShaSchema.optional(), {
    param: { name: "to", in: "query", required: false },
    description:
      "Head of the range, **inclusive**. Omit it to use the newest commit that touched this " +
      "document. Must be a commit sha, like `from`.",
  }),
});

/**
 * One document's change across a commit range: the range that was actually read,
 * what it did to the document in numbers, and as much of the unified diff as the
 * bound allows.
 *
 * **The resolved range is reported back, always.** Both query parameters are
 * optional and both defaults are computed server-side, so a caller that omitted
 * one would otherwise have no way to know what it read — and `corpus doc diff`
 * has to be able to say. The values here are shas, so they can be passed straight
 * back to pin the same range later.
 *
 * **Truncation is stated, never silent** — the rule `ContextPack`'s `truncated`
 * field establishes, and for the same reason: an agent that believes it has seen a
 * whole change and has not will act on the half it saw. `totalChars` makes the
 * statement quantitative, so the caller knows the scale of what it is missing
 * rather than only that something is missing.
 *
 * **The cut rule published here is SPEC.md §9.2's, and it was not** (CONTRACT-032,
 * escalated from SERVER-058). §9.2's signed sentence — *"Truncation drops whole
 * hunks while it can and then cuts the straddling hunk at a line boundary, so the
 * bound is spent on content rather than on alignment"* — has stood since the
 * rider of 2026-08-05. `truncated` published something narrower: whole hunks
 * only, with one exception for a hunk larger than the **whole** bound. The gap
 * between the two is the ordinary edit shape, because a save re-stamps
 * `updated:` and git emits a tiny frontmatter hunk before the body hunk: with the
 * body hunk under the bound but past the budget left for it, the narrow rule
 * drops it whole and answers with the timestamp alone. Measured on the real
 * route at **401 characters of an allowed 16 000**, and at 231 of 16 000 for a
 * diff totalling 21 001.
 *
 * The cost of §9.2's rule is stated rather than glossed: the last hunk of a
 * truncated diff may be a prefix of itself, so its header's line counts describe
 * more lines than follow it. That is what `truncated: true` is for, and no
 * consumer in this repository applies a diff — the CLI prints it and the agent
 * reads it.
 *
 * **`apps/server/src/edit/diff.ts`'s `truncateDiff` implements the narrow rule.**
 * Under §9.2's rule the function collapses to "the last line boundary at or
 * before the bound", because every hunk boundary is also a line boundary — which
 * is exactly why SERVER-058 could not make the change without one here first.
 * Where no line boundary sits at or before the bound it answers the **empty
 * string** rather than a mid-line prefix (SERVER-149), because §9.2's rider says
 * the cut is never mid-line and a mid-line prefix of a diff is not readable as
 * one. `truncated` and `totalChars` still accompany it, so an empty body under
 * truncation is never "nothing changed".
 */
export const DocDiffSchema = openapi(
  z.object({
    id: DocumentIdSchema.describe("The document the diff is for."),
    path: z
      .string()
      .describe(
        "Workspace-relative path of the document's file, e.g. `data/docs/finance/mortgage.md` — " +
          "the path the diff was taken at, and what a `--- a/… +++ b/…` header in `diff` names.",
      ),
    from: CommitShaSchema.nullable().describe(
      "The resolved base of the range, exclusive — the value used, whether supplied or defaulted. " +
        "A default is the newest commit before `to` that touched **this document**, never `to`'s " +
        "parent (a party-scoped commit window makes the parent routinely someone else's save to " +
        "another file); `EMPTY_TREE_OBJECT_ID` when nothing before `to` ever touched this " +
        "document. `null` only in the no-history case below, where `to` is null too.",
    ),
    to: CommitShaSchema.nullable().describe(
      "The resolved head of the range, inclusive. **`null` exactly when the workspace has no " +
        "committed history for this document** — a file written but not yet committed, or a " +
        "workspace with no git at all (SPEC.md §11). In that case `from` is null too, `diff` is " +
        "empty, `stats` are zero and `truncated` is false: an answer, not an error, because a " +
        "document that has never been committed genuinely has no change to show.",
    ),
    stats: DocChangeStatsSchema.describe(
      "How much changed across the **whole** range, even when `diff` below was truncated. The same " +
        "shape a `doc.edited` event carries, so a caller can compare what it was told with what it " +
        "fetched.",
    ),
    diff: z
      .string()
      .max(DOC_DIFF_MAX_CHARS)
      .describe(
        `The unified diff of this document's file across the range, at most ${DOC_DIFF_MAX_CHARS} ` +
          "characters (`DOC_DIFF_MAX_CHARS`). Path-scoped, so commits in the range that touched " +
          "other documents contribute nothing. Plain text, rendered as-is and never interpreted — " +
          "a diff of a markdown document contains markdown, and a client that renders it would be " +
          "rendering the user's document instead of showing the change to it. Empty when nothing " +
          "changed in the range, which is a legitimate answer.",
      ),
    truncated: z
      .boolean()
      .describe(
        "`true` when the diff was cut to `DOC_DIFF_MAX_CHARS`. **Whole hunks are kept while they " +
          "fit, and the hunk that straddles the bound is then cut at a line boundary** " +
          "(SPEC.md §9.2), so the bound is spent on content rather than on alignment: a change " +
          "whose body hunk lands just under the cap comes back as that change, not as the " +
          "`updated:` frontmatter hunk in front of it. The cut is never mid-line and never mid " +
          "hunk-header, so what is returned is always something a reader can read — **but the " +
          "last hunk of a truncated diff may be a prefix of itself**, and its header's line counts " +
          "then describe more lines than follow. Read it, do not apply it: `truncated` is the flag " +
          "that says which you have. Stated rather than silent (the rule the context pack's own " +
          "`truncated` sets): an agent acting on half a change while believing it saw all of it " +
          "is the failure this flag exists to prevent, and `stats` plus `totalChars` say how much " +
          "is missing.",
      ),
    totalChars: z
      .number()
      .int()
      .min(0)
      .describe(
        "Length in characters of the **full** diff before truncation; equal to `diff`'s length " +
          "whenever `truncated` is false. Lets a caller report the scale of what it did not get " +
          "(`showing 16000 of 42311 characters`) and decide whether to narrow the range and ask " +
          "again.",
      ),
  }),
  "DocDiff",
);

export type CommitSha = z.infer<typeof CommitShaSchema>;
export type DocChangeStats = z.infer<typeof DocChangeStatsSchema>;
export type EditSessionEndReason = z.infer<typeof EditSessionEndReasonSchema>;
export type DocEditedPayload = z.infer<typeof DocEditedPayloadSchema>;
export type DocDiffQuery = z.infer<typeof DocDiffQuerySchema>;
export type DocDiff = z.infer<typeof DocDiffSchema>;
