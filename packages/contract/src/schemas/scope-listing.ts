import { z } from "zod";
import { DocStatusSchema } from "./doc.js";
import { DocumentIdSchema, ThreadIdSchema } from "./id.js";
import { openapi } from "./openapi-metadata.js";

/**
 * **What is in a scope** — the answer `GET /api/threads/{id}/scope` gives
 * (CONTRACT-068; SPEC.md §7's resident rider, SHARED-043).
 *
 * ## The question, and why nothing answered it
 *
 * §7 defines a designated thread's scope — the thread, every thread whose parent
 * chain reaches it, every document whose `origin` reaches it, and every thread
 * on such a document — and makes membership **computed, never stored**: nothing
 * carries a scope marker, and the server derives it at enqueue time by walking
 * `origin` and `parent` up from one artifact to the lane that claims it
 * (`../scope.ts`, `walkScope`). That walk climbs. Nothing walked the other way —
 * *given a lane, what is in it?* — so a person asking "what does this agent own"
 * had no answer to read, and a resident asking "what do I own" had none either.
 *
 * ## It is a query, and the walk is the same walk
 *
 * Computed per request, so §7 stays literally true: no membership table, no
 * cache, nothing for `db rebuild` to reconstruct. The server answers by running
 * **the identical `walkScope` the queue routes with** over each candidate and
 * keeping the ones whose lane is this thread — not a second implementation of
 * the rule. `scripts/mention-offer-parity.test.ts` records what happens when one
 * rule gets two implementations, and `packages/kit/src/recipient/scopeWalk.ts`'s
 * docblock records what it cost when the composer and the server each had their
 * own: *a person pressed the row they had just read, and Ana never heard about
 * the conversation on the draft she wrote*. What this listing says is in a lane
 * is therefore what an event posted there would be routed by — and the
 * `ScopeMember.via` field is the edge that walk took, reported rather than
 * re-derived.
 *
 * ## One frugal line per hit, and never a body
 *
 * §7's retrieval discipline: one line per hit — id, kind, title, status, and
 * how it got here — and no body. A scope listing is a map of what an agent
 * owns, not a reading list, and the escalation is the ordinary read
 * (`GET /api/docs/{id}`, `GET /api/threads/{id}`) for the one member a caller
 * decides to open.
 *
 * ## Bounded, so a scope cannot be an enumeration
 *
 * A long-lived conversation's scope grows without limit, and a listing with no
 * bound is the sweep §7 forbids the agent from doing — one verb away. So the
 * page is fixed at {@link SCOPE_PAGE_SIZE}, published as `maxItems`, with a
 * `truncated` flag that says the cut happened. **No cursor, and no `total`**,
 * both on purpose: the bound exists so the listing cannot be an enumeration,
 * not to make paging a feature, and a `total` would cost the server the full
 * enumeration the bound is there to avoid (`InProgressSet.total` is cheap — a
 * directory count — which is why it has one and this does not). A truncated
 * listing is still the right answer to "what do you own, roughly"; a caller
 * that needs one particular member asks for it by id.
 *
 * **The order makes the cut meaningful**: the root thread first, then the most
 * recently updated members first, so a truncated page holds the live end of
 * the scope and what falls off is what nothing has touched for longest — the
 * rule `InProgressSet` set for the same reason.
 *
 * ## Who asks
 *
 * The board (UI-125: who is resident, and over what) and the resident itself
 * (CLI-054: "what do I own"). The same endpoint for both, because it is the
 * same question, and because a resident reading its own lane is not a sweep —
 * it is the one thing §7 says it owns.
 */

/**
 * How many members one listing carries before it says `truncated`.
 *
 * Fixed rather than a query parameter: the bound lives in the contract so that
 * no caller can raise it into an enumeration, and so that the two consumers
 * (board and CLI) cannot disagree about what "the scope" shows.
 */
export const SCOPE_PAGE_SIZE = 200;

/**
 * What kind of artifact a member is. A thread *is* a document (§6), so the
 * distinction is for the reader — it decides which verb opens it and which
 * statuses are possible — and never for the walk, which treats both alike.
 */
export const SCOPE_MEMBER_KINDS = ["thread", "doc"] as const;

export const ScopeMemberKindSchema = z
  .enum(SCOPE_MEMBER_KINDS)
  .describe(
    "`thread` for a conversation (open it with `GET /api/threads/{id}`), `doc` for any other " +
      "document (`GET /api/docs/{id}`). A thread is a document (SPEC.md §6), so this tells a " +
      "reader which surface to open and nothing about how the member reached the scope.",
  );

/**
 * The edge by which a member reaches the scope — the one `walkScope` (`../scope.ts`)
 * followed first from that member on its way to the root, **in the order §7
 * sanctions them**: a thread's parent chain before a document's origin, so a
 * member carrying both edges reports `parent`. `self` is the root and only the
 * root.
 */
export const SCOPE_MEMBER_VIAS = ["self", "parent", "origin"] as const;

export const ScopeMemberViaSchema = z
  .enum(SCOPE_MEMBER_VIAS)
  .describe(
    "How this member reaches the scope (SPEC.md §7), as the same walk that routes the queue " +
      "reports it: `self` — this is the designated thread itself, the scope's root and the lane's " +
      "name, always the first member; `parent` — a thread whose parent chain reaches the root, " +
      "directly or through a document in scope (§7's “every thread on such a document”); " +
      "`origin` — a document whose `origin` reaches the root, i.e. written by a job run from this " +
      "conversation, including one written before the thread was designated. A member with both " +
      "edges reports `parent`, because the walk tries a thread's parent chain before its own " +
      "origin (the ranking `walkScope` documents). It is the edge the walk took, reported rather " +
      "than re-derived by the reader.",
  );

/**
 * One line per hit (SPEC.md §7's retrieval discipline): enough to recognise the
 * member and to open it, never its body.
 */
export const ScopeMemberSchema = openapi(
  z.object({
    id: DocumentIdSchema.describe(
      "The member's id — a `th_` id for a thread, a `doc_` id for a document. Open it with the " +
        "verb `kind` names.",
    ),
    kind: ScopeMemberKindSchema,
    title: z.string().describe("The member's **current** title, read at response time."),
    status: DocStatusSchema.describe(
      "The member's own lifecycle status, as its listing row carries it: `open` or `resolved` " +
        "for a thread, `open`, `resolved` or `archived` for a document. **An archived document " +
        "is still in scope**: membership is the walk over `origin` and `parent`, which archiving " +
        "does not touch (SPEC.md §7) — detaching is the escape hatch, not archiving — so it is " +
        "listed, and this field is what tells a reader it is archived.",
    ),
    via: ScopeMemberViaSchema,
  }),
  "ScopeMember",
);

/**
 * The listing. `thread` is the root and the lane's name, restated at the top so
 * a caller holding only the body knows whose scope it is reading.
 */
export const ThreadScopeSchema = openapi(
  z.object({
    thread: ThreadIdSchema.describe(
      "The designated thread this is the scope of — the root, and the name of the lane every " +
        "member's events are stamped with (SPEC.md §7). It is also `members[0].id`.",
    ),
    members: z
      .array(ScopeMemberSchema)
      .max(SCOPE_PAGE_SIZE)
      .describe(
        `Every artifact in the scope, capped at ${SCOPE_PAGE_SIZE}: the root thread first ` +
          '(`via: "self"`), then every other member most recently updated first, so when the ' +
          "cap bites the page holds the live end of the scope and what falls off is what nothing " +
          "has touched for longest. **Computed per request by the same walk the queue routes " +
          "with** (SPEC.md §7: scope is computed, never stored) — what is listed here is exactly " +
          "what an event posted there would be routed to this lane by, and nothing else. One line " +
          "per member and never a body.",
      ),
    truncated: z
      .boolean()
      .describe(
        `True when the scope holds more than ${SCOPE_PAGE_SIZE} members and the list was cut. ` +
          "Stated rather than left to be derived, for the reason `DocDiff.truncated` gives: a " +
          "capped list that looks complete is the failure this flag exists to prevent. **There is " +
          "no cursor and no total**, deliberately: the bound exists so that a scope cannot be " +
          "enumerated, and a count would cost the very enumeration it forbids. A caller that " +
          "needs one particular member reads it by id.",
      ),
  }),
  "ThreadScope",
);

export type ScopeMemberKind = z.infer<typeof ScopeMemberKindSchema>;
export type ScopeMemberVia = z.infer<typeof ScopeMemberViaSchema>;
export type ScopeMember = z.infer<typeof ScopeMemberSchema>;
export type ThreadScope = z.infer<typeof ThreadScopeSchema>;
